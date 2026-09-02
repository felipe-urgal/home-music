# Downloads offline

Este documento registra o comportamento corrente dos downloads offline do Home Music: scheduler, cache físico, referências lógicas de playlists/pastas, isolamento entre contas, sincronização e limites de background.

## Estado atual

O Home Music permite disponibilizar offline:

- uma faixa individual;
- várias faixas selecionadas no desktop;
- uma playlist inteira;
- uma pasta inteira, incluindo suas subpastas.

Todas essas superfícies reutilizam **um único scheduler**, limitado a **3 downloads simultâneos**, e **um único artefato físico por `userId + trackId`**.

Em navegadores com Background Fetch e service worker capability v4, a transferência já iniciada pode ser delegada ao navegador para sobreviver melhor à suspensão da página. Navegadores sem essa API mantêm o `fetch()` foreground anterior. A garantia por plataforma continua dependendo da validação em dispositivos reais da issue [#81](https://github.com/felipe-urgal/home-music/issues/81).

## Modelo: bytes físicos x referências lógicas

A #174 separa duas responsabilidades:

```text
Cache Storage / manifesto físico
1 artefato por trackId
             ↑
             │
manifesto de referências lógicas
├── download individual
├── playlist A
├── playlist B
└── pasta X
```

A mesma faixa pode pertencer a várias coleções e também ter intenção individual sem ocupar espaço físico adicional.

Remover uma referência só apaga o áudio quando **nenhuma outra referência do mesmo usuário** ainda depende daquele `trackId`.

## Namespace multiusuário

O estado usa:

```text
home-music:offline-user-id:v1
home-music:offline-tracks:v2:<userId>
home-music:offline-references:v1:<userId>
home-music-offline-audio-v2-<userId>
home-music-offline-client-scope-v1
/offline-audio/<trackId>
```

Responsabilidades:

- `offline-tracks:v2`: manifesto dos artefatos físicos realmente disponíveis;
- `offline-references:v1`: intenção lógica individual e snapshots de playlists/pastas;
- `offline-audio-v2`: bytes de áudio no Cache Storage;
- client scope: associação mínima entre aba/service worker e usuário autenticado.

Uma troca de conta durante um download não transfere o resultado para a nova identidade. Cada job captura o `userId` no início e o estado React também é escopado pelo usuário ativo. No caminho Background Fetch, a registration também carrega o proprietário original e o service worker grava no cache daquele usuário.

## Migração conservadora

Instalações que já possuíam downloads físicos antes do manifesto de referências são migradas sem cleanup destrutivo.

Ao criar `offline-references:v1` pela primeira vez, todos os `trackId` encontrados no manifesto físico existente são tratados como **downloads individuais**.

Isso pode preservar mais bytes do que o mínimo após a atualização, mas impede que a primeira remoção de uma coleção recém-criada apague conteúdo que o usuário já havia baixado explicitamente.

Manifesto de referências corrompido ou de versão incompatível também degrada para essa migração conservadora.

## Scheduler global e deduplicação

Quando há mais de três pedidos:

```text
download A ─ ativo
download B ─ ativo
download C ─ ativo
download D ─ aguardando
download E ─ aguardando
```

A chave do scheduler é `userId + trackId`.

Consequências:

- playlist e pasta que compartilham uma música reutilizam o mesmo job;
- download individual iniciado enquanto uma coleção baixa a mesma faixa reutiliza o mesmo job;
- uma coleção não cria um segundo scheduler;
- falha de uma faixa não cancela automaticamente as demais;
- Background Fetch não cria uma fila paralela: a registration é iniciada dentro do mesmo job do scheduler.

A sincronização de coleção pode preparar até três itens em paralelo, mas cada faixa ainda atravessa o scheduler global, que continua sendo a autoridade final de concorrência.

## Download físico seguro

Antes de iniciar a rede e novamente antes de publicar o resultado, o job confirma que o `trackId` ainda possui alguma referência lógica.

Fluxo simplificado:

```text
referência lógica existe?
   ↓ sim
scheduler global
   ↓
Background Fetch suportado pelo worker v4?
   ├── sim → navegador transfere + worker persiste resposta completa
   └── não → fetch autenticado foreground
   ↓
bytes confirmados no cache da conta
   ↓
referência ainda existe?
   ├── não → remove blob recém-gravado
   └── sim → publica no manifesto físico
```

No fallback foreground, a checagem best-effort de quota continua acontecendo antes de `cache.put()`. No caminho Background Fetch, o próprio navegador pode rejeitar a transferência por quota; o manifesto não é publicado em caso de falha.

A validação depois da transferência fecha a corrida em que uma coleção é removida enquanto o download está em andamento. O service worker **não escreve `offline-tracks:v2`**: ele apenas persiste uma resposta completa no cache correto. A página continua sendo a autoridade de publicação do manifesto após revalidar a referência lógica.

Falha de quota, resposta incompleta, ausência do blob esperado ou falha de gravação nunca devem produzir manifesto físico falso de “disponível”.

## Background Fetch progressivo

O caminho de background é ativado somente quando todos os requisitos abaixo estão presentes:

1. service worker ativo responde capability **v4**;
2. a resposta anuncia `backgroundFetch: true`;
3. o registro expõe `ServiceWorkerRegistration.backgroundFetch`.

Se qualquer requisito faltar, a transferência usa o fluxo foreground existente.

A registration usa um identificador escopado por `userId + trackId` e uma `Request` same-origin com credenciais. No evento `backgroundfetchsuccess`, o worker:

1. valida o formato da registration e os IDs;
2. exige exatamente uma request `GET` same-origin;
3. exige que a URL seja exatamente `/api/tracks/<trackId>/stream`;
4. exige resposta completa HTTP `200`;
5. grava a resposta somente em `home-music-offline-audio-v2-<userId>`.

Quando a página volta a executar, ela aguarda o blob confirmado nesse cache e continua o fluxo normal de referência + manifesto. Se a referência tiver desaparecido durante a suspensão, os bytes são removidos e não são anunciados como concluídos.

Um worker v3 antigo controlando temporariamente um bundle novo não recebe registrations de Background Fetch: o frontend detecta a versão e usa o fallback até a ativação do v4.

## Download individual

Ao pedir uma faixa individualmente:

1. a referência individual é persistida;
2. o scheduler garante os bytes físicos;
3. se a faixa já existia por playlist/pasta, nenhum segundo arquivo é criado.

Ao remover a intenção individual:

- se nenhuma coleção depende da faixa, manifesto físico e cache são removidos;
- se uma coleção ainda depende dela, apenas a referência individual some e os bytes permanecem.

Quando uma faixa já existe fisicamente **somente por uma coleção**, a UI não oferece uma remoção individual inexistente. Em vez disso, tabela e player permitem **manter também como download individual**; essa promoção adiciona apenas a referência lógica e reutiliza o blob já presente. Depois disso, remover a intenção individual continua preservando os bytes enquanto a coleção depender da faixa.

## Playlist offline

No detalhe da playlist, `Disponibilizar offline` captura o snapshot completo e ordenado de `playlist.trackIds`, sem aplicar busca/filtros temporários da tela.

O snapshot guarda:

- tipo `playlist`;
- ID persistente da playlist;
- nome apresentado ao usuário;
- `trackIds` ordenados;
- instante da última atualização offline.

Renomear, reordenar, adicionar ou remover faixas da playlist faz o snapshot corrente ficar **desatualizado**. A UI mostra essa diferença e exige `Atualizar offline` explicitamente.

Não há exclusão automática silenciosa em background.

## Pasta offline

No detalhe de uma pasta, a coleção usa `folderView.allTracks`: todas as faixas daquela pasta e de suas subpastas, sem restringir o snapshot à busca/filtro ativo.

O identificador lógico é o `folderPath` canônico conhecido pela biblioteca.

Depois de scan/movimentação de arquivos, um conjunto diferente de `trackIds` torna a coleção desatualizada. O usuário decide quando aplicar `Atualizar offline`.

## Atualização de coleção

A atualização persiste primeiro o novo snapshot desejado. Isso transforma falha de rede/quota em estado **parcial e recuperável**, em vez de produzir bytes sem dono.

Para faixas removidas do snapshot anterior:

1. a referência antiga deixa de existir;
2. o Home Music verifica se há outra referência individual/coleção;
3. somente IDs sem nenhum dono têm os bytes removidos.

Para faixas novas, o scheduler global garante os downloads que ainda faltam.

## Pausar, retomar e remover

### Pausar

`Pausar` interrompe a inclusão de novas faixas na sincronização daquela coleção.

Uma transferência já iniciada pode terminar; isso é intencional porque o scheduler é compartilhado e o mesmo job pode servir outra referência. Em navegador com Background Fetch, uma registration já entregue ao navegador também pode concluir depois da página entrar em background. A revalidação da referência antes do manifesto continua impedindo publicação indevida.

Enquanto esses jobs já iniciados drenam, a ação de retomada permanece desabilitada como `Pausando…`, evitando iniciar uma segunda execução concorrente para a mesma coleção.

Quando não há mais job pendente daquela execução, a coleção permanece persistida como desejada e a UI oferece `Retomar`. A retomada reutiliza o scheduler/cache existentes e usa o snapshot corrente da coleção conectada.

### Remover coleção

Remover uma coleção:

1. invalida o controle da sincronização em andamento;
2. remove a referência lógica da coleção;
3. limpa estado de erro/pausa daquela coleção;
4. coleta apenas bytes que ficaram sem qualquer referência.

Jobs em voo revalidam a referência antes de publicar, evitando reintroduzir uma faixa que acabou de perder seu último dono.

## Estados e progresso

Uma coleção pode aparecer como:

- não baixada;
- baixando;
- disponível;
- parcial;
- erro;
- pausada;
- conteúdo alterado/desatualizado.

A UI exibe `baixadas / total`. Downloads concluídos são calculados a partir do manifesto físico, não apenas da intenção lógica.

Erro em uma ou mais faixas mantém o snapshot da coleção e permite nova tentativa explícita.

## Biblioteca em modo offline

Quando o servidor está inalcançável, a biblioteca local organiza conteúdo em:

- **Coleções offline** — playlists/pastas persistidas;
- **Downloads individuais** — faixas com intenção individual.

Uma faixa que pertence a duas coleções pode aparecer logicamente em ambas, mas o total de armazenamento no topo conta os bytes físicos uma única vez.

Cada coleção pode reproduzir o subconjunto que realmente está disponível no cache; coleções parciais não anunciam faixas ausentes como baixadas.

## Entrada manual no modo offline

O usuário autenticado também pode abrir essa mesma biblioteca offline enquanto o servidor continua disponível, em `Minha conta → Preferências → Modo offline`.

Esse controle não simula perda de rede nem cria outro cache. Ele apenas troca a composição ativa para o `OfflineApp` já existente, portanto navegação e reprodução passam a usar somente os artefatos físicos reconciliados do usuário naquele dispositivo.

A ação fica desabilitada enquanto os downloads estão carregando, quando o navegador não suporta o armazenamento offline ou quando não existe nenhuma música física disponível. Ao sair, a aplicação retorna ao fluxo online e refaz a verificação de autenticação/conectividade.

## Quota e pressão de armazenamento

No caminho foreground, antes de cada novo artefato o frontend consulta `navigator.storage.estimate()` quando disponível e recusa o download quando o tamanho conhecido consumiria praticamente todo o espaço restante.

No caminho Background Fetch, o navegador controla a reserva e pode encerrar a operação com `quota-exceeded`. Como os bytes já são persistidos pelo worker quando a transferência termina, a checagem foreground de headroom não é repetida depois desse ponto.

`navigator.storage.persist()` continua best-effort depois da publicação do manifesto.

Limites:

- tamanho pode ser desconhecido quando o servidor/navegador não fornece `Content-Length`;
- o navegador ainda pode remover Cache Storage sob pressão severa;
- na inicialização, o manifesto físico é reconciliado com os bytes realmente presentes;
- uma coleção pode ficar parcial depois de eviction e deve ser atualizada/rebaixada explicitamente.

## Reconciliação e stale state

Na inicialização do namespace:

- registros físicos sem bytes são removidos do manifesto;
- blobs de cache sem registro físico esperado são removidos;
- referências lógicas permanecem, permitindo mostrar coleção parcial e tentar novamente depois;
- o manifesto lógico não cria bytes por conta própria.

Um Background Fetch concluído enquanto a página está suspensa pode produzir temporariamente um blob sem manifesto. Na retomada normal da mesma página, o job revalida a referência e publica o manifesto. Se a página for encerrada/recarregada antes dessa etapa, o fluxo não promete retomada/publicação automática; blobs órfãos continuam sujeitos à reconciliação conservadora.

Se uma faixa deixar de existir ou ficar desativada no servidor, o snapshot da playlist/pasta pode ficar desatualizado. Enquanto offline, somente o snapshot e os bytes locais conhecidos estão disponíveis; quando conectado, a coleção corrente é comparada à biblioteca real e a UI pede atualização.

## Service worker e capability

O protocolo do service worker é **versão 4**.

O worker:

- recebe o `userId` ativo na negociação;
- associa usuário ao `clientId`/aba;
- persiste o escopo mínimo;
- anuncia `backgroundFetch` somente quando a API existe no registro ativo;
- persiste respostas completas de registrations válidas no cache offline do proprietário;
- não publica o manifesto físico por conta própria;
- só serve `/offline-audio/<trackId>` para client com escopo válido;
- abre o cache da conta associada ao client;
- mantém `/api/*` fora do cache estático.

## Cache legado

Versões anteriores ao isolamento por conta usavam:

```text
home-music:offline-tracks:v1
home-music-offline-audio-v1
```

Como não possuíam ownership, continuam sendo descartadas de modo best-effort; não são atribuídas automaticamente a uma conta.

Isso é diferente da migração `tracks:v2 → references:v1`: os dados `v2` já possuem ownership e, por isso, podem ser preservados conservadoramente como intenção individual.

## Limite de ciclo de vida e #81

A estratégia é progressiva por capacidade:

- trocar de tela dentro da SPA: **suportado**;
- Chromium/Android com Background Fetch + worker v4: transferência iniciada pode continuar enquanto a página fica em background/tela bloqueada, sujeita às políticas reais do navegador/sistema;
- navegadores sem Background Fetch: continuam usando `fetch()` no contexto da página e podem interromper ao suspender JavaScript;
- Safari/iPhone/iPad: permanece no fallback enquanto a plataforma não expuser Background Fetch;
- recarregar/fechar aba: não há garantia de retomada/publicação do job;
- download concluído e publicado: permanece até remoção lógica/eviction do navegador.

A implementação **não fecha a #81**. O aceite continua exigindo repetir a matriz abaixo em dispositivos físicos no head final e registrar o comportamento observado por plataforma/browser/modelo.

### Matriz mínima de validação mobile real

| Plataforma | Cenário | Aceite |
| --- | --- | --- |
| Android/Chrome/PWA | iniciar arquivo/coleção grande e bloquear a tela | confirmar se Background Fetch mantém a transferência e se a faixa só aparece concluída depois de blob íntegro + revalidação |
| Android/Chrome/PWA | iniciar três downloads e enviar app para background | nenhum item pode aparecer concluído sem arquivo íntegro; scheduler continua limitado a 3 |
| iPhone/iPad/Safari/PWA | iniciar arquivo/coleção grande e bloquear a tela | registrar o comportamento do fallback sem assumir execução contínua de JS |
| iPhone/iPad/Safari/PWA | alternar para outro app e retornar | referências, cache e manifesto devem permanecer consistentes após suspensão |

## Fronteira local

O isolamento multiusuário evita vazamento durante uso normal do mesmo origin: login/logout, troca de conta, reload, múltiplas abas e modo offline.

Cache Storage e `localStorage` pertencem ao perfil do navegador. Essa é uma fronteira lógica de produto, não criptografia contra alguém que controla DevTools ou armazenamento local do dispositivo.

## Regressões automatizadas

A cobertura de downloads offline inclui:

- migração conservadora;
- deduplicação de IDs e referências sobrepostas;
- remoção por referência;
- preservação de download individual compartilhado;
- promoção de faixa já física por coleção para intenção individual sem novo blob;
- detecção de snapshot alterado;
- manifesto corrompido/incompatível;
- escopo da registration Background Fetch por `userId + trackId` e mensagens de falha que não anunciam sucesso;
- fluxo Playwright real de playlist sobreposta + atualização + garbage-collection;
- controle de coleção no layout mobile;
- fronteira de composição garantindo que a entrada manual continue delegando ao `App.tsx` e reutilizando o `OfflineApp`.

A validação de continuidade em tela bloqueada permanece necessariamente física na #81; testes automatizados verificam invariantes, não substituem o sistema operacional real.
