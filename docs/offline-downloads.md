# Downloads offline

Este documento registra o comportamento corrente dos downloads offline do Home Music: scheduler, cache físico, referências lógicas de playlists/pastas, isolamento entre contas, sincronização e limites de background.

## Estado atual

O Home Music permite disponibilizar offline:

- uma faixa individual;
- várias faixas selecionadas no desktop;
- uma playlist inteira;
- uma pasta inteira, incluindo suas subpastas.

Todas essas superfícies reutilizam **um único scheduler**, limitado a **3 downloads simultâneos**, e **um único artefato físico por `userId + trackId`**.

A continuidade garantida é dentro da mesma execução ativa da aplicação/aba. Background e tela bloqueada continuam dependendo da validação em dispositivos reais da issue [#81](https://github.com/felipe-urgal/home-music/issues/81).

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

Uma troca de conta durante um download não transfere o resultado para a nova identidade. Cada job captura o `userId` no início e o estado React também é escopado pelo usuário ativo.

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
- falha de uma faixa não cancela automaticamente as demais.

A sincronização de coleção pode preparar até três itens em paralelo, mas cada faixa ainda atravessa o scheduler global, que continua sendo a autoridade final de concorrência.

## Download físico seguro

Antes de iniciar a rede e novamente antes de publicar o resultado, o job confirma que o `trackId` ainda possui alguma referência lógica.

Fluxo simplificado:

```text
referência lógica existe?
   ↓ sim
scheduler global
   ↓
fetch autenticado da faixa completa
   ↓
quota best-effort
   ↓
cache.put
   ↓
referência ainda existe?
   ├── não → remove blob recém-gravado
   └── sim → publica no manifesto físico
```

Essa segunda validação fecha a corrida em que uma coleção é removida enquanto o `fetch()` está em andamento.

Falha de quota ou gravação nunca deve produzir manifesto físico falso de “disponível”.

## Download individual

Ao pedir uma faixa individualmente:

1. a referência individual é persistida;
2. o scheduler garante os bytes físicos;
3. se a faixa já existia por playlist/pasta, nenhum segundo arquivo é criado.

Ao remover a intenção individual:

- se nenhuma coleção depende da faixa, manifesto físico e cache são removidos;
- se uma coleção ainda depende dela, apenas a referência individual some e os bytes permanecem.

A UI desktop diferencia uma faixa que existe somente por coleção e não oferece sua remoção como se fosse um download individual.

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

Um `fetch()` já iniciado pode terminar; isso é intencional porque o scheduler é compartilhado e o mesmo job pode servir outra referência.

A coleção permanece persistida como desejada e pode ser retomada com `Atualizar offline`.

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

## Quota e pressão de armazenamento

Antes de cada novo artefato, o frontend consulta `navigator.storage.estimate()` quando disponível e recusa o download quando o tamanho conhecido consumiria praticamente todo o espaço restante.

`navigator.storage.persist()` continua best-effort.

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

Se uma faixa deixar de existir ou ficar desativada no servidor, o snapshot da playlist/pasta pode ficar desatualizado. Enquanto offline, somente o snapshot e os bytes locais conhecidos estão disponíveis; quando conectado, a coleção corrente é comparada à biblioteca real e a UI pede atualização.

## Service worker e capability

O protocolo do service worker permanece **versão 3**. A #174 não cria rota ou protocolo novo de áudio.

O worker:

- recebe o `userId` ativo na negociação;
- associa usuário ao `clientId`/aba;
- persiste o escopo mínimo;
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

O scheduler executa `fetch()` e `cache.put()` no contexto ativo da aplicação.

- trocar de tela dentro da SPA: **suportado**;
- recarregar/fechar aba: pode interromper operação em andamento;
- bloquear tela/background: depende do navegador/sistema;
- download concluído: permanece até remoção lógica/eviction do navegador.

A #174 **não fecha nem altera o aceite da #81**.

### Matriz mínima de validação mobile real

| Plataforma | Cenário | Aceite |
| --- | --- | --- |
| Android/Chrome/PWA | iniciar arquivo/coleção grande e bloquear a tela | medir se terminou, pausou, retomou ou falhou sem corromper referência/cache |
| Android/Chrome/PWA | iniciar três downloads e enviar app para background | nenhum item pode aparecer concluído sem arquivo íntegro |
| iPhone/iPad/Safari/PWA | iniciar arquivo/coleção grande e bloquear a tela | medir comportamento real sem assumir execução contínua de JS |
| iPhone/iPad/Safari/PWA | alternar para outro app e retornar | referências, cache e manifesto devem permanecer consistentes após suspensão |

## Fronteira local

O isolamento multiusuário evita vazamento durante uso normal do mesmo origin: login/logout, troca de conta, reload, múltiplas abas e modo offline.

Cache Storage e `localStorage` pertencem ao perfil do navegador. Essa é uma fronteira lógica de produto, não criptografia contra alguém que controla DevTools ou armazenamento local do dispositivo.

## Regressões automatizadas

A #174 adiciona cobertura para:

- migração conservadora;
- deduplicação de IDs e referências sobrepostas;
- remoção por referência;
- preservação de download individual compartilhado;
- detecção de snapshot alterado;
- manifesto corrompido/incompatível;
- fluxo Playwright real de playlist sobreposta + atualização + garbage-collection;
- controle de coleção no layout mobile.
