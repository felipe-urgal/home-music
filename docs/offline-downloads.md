# Downloads offline

Este documento registra o comportamento atual dos downloads offline do Home Music, incluindo concorrência, superfícies mobile/desktop, limites de background e isolamento entre contas no mesmo navegador.

## Estado atual

O Home Music permite baixar faixas individualmente e em lote para reprodução offline. O scheduler é global à aplicação e limita a execução a **3 downloads simultâneos**.

A mesma infraestrutura é compartilhada entre player e biblioteca desktop. Navegar entre telas não cria uma segunda fila nem cancela operações em andamento.

A continuidade garantida hoje é **dentro da mesma execução ativa da aplicação/aba**. A validação de background/tela bloqueada em dispositivos reais continua aberta na issue [#81](https://github.com/felipe-urgal/home-music/issues/81).

## Scheduler global

Quando há mais de três pedidos:

```text
download A ─ ativo
download B ─ ativo
download C ─ ativo
download D ─ aguardando
download E ─ aguardando
```

A chave do scheduler inclui `userId + trackId`. Isso evita duplicar o mesmo job para a mesma conta e impede que operações de identidades diferentes compartilhem estado por engano.

Falha em uma faixa não cancela os demais downloads já entregues ao scheduler.

## Continuidade durante navegação

O estado offline é instanciado no nível raiz da aplicação. Depois de iniciar um download, o usuário pode navegar por player, biblioteca, artistas, álbuns, pastas, playlists e estatísticas sem abortar o job por troca de tela.

O conjunto de IDs em andamento permanece observável e a UI volta a refletir o estado quando a faixa reaparece.

## Superfícies

### Player

Uma faixa pode ser baixada/removida do offline a partir do contexto de reprodução.

### Biblioteca desktop

Cada faixa expõe estado compatível com o mesmo scheduler:

- baixar;
- aguardando/em andamento;
- disponível offline;
- remover download concluído.

A seleção múltipla oferece download em lote, mas a concorrência real continua limitada a três jobs.

## Armazenamento

Cada job:

1. captura o `userId` que iniciou a operação;
2. baixa a faixa completa pela rota autenticada de streaming;
3. exige resposta HTTP válida;
4. consulta estimativa de quota quando o navegador oferece `navigator.storage.estimate()`;
5. grava o áudio no Cache Storage exclusivo daquele usuário;
6. atualiza o manifesto do mesmo usuário **somente após** o cache concluir;
7. tenta solicitar armazenamento persistente como operação best-effort.

Falha de quota ou gravação nunca deve produzir um registro falso de “disponível offline”.

## Namespace multiusuário

O estado atual usa:

```text
home-music:offline-user-id:v1
home-music:offline-tracks:v2:<userId>
home-music-offline-audio-v2-<userId>
home-music-offline-client-scope-v1
/offline-audio/<trackId>
```

Uma troca de conta durante um download não move o resultado para a nova conta: o job mantém a identidade capturada no início.

A identidade offline ativa é atualizada depois que `/api/auth/status` confirma o usuário e é removida quando logout/sessão expirada confirmam que a identidade não deve continuar ativa.

Quando o servidor está realmente inalcançável, o último namespace autenticado pode ser usado **somente** para abrir os downloads daquela conta.

## Service worker e capability

O protocolo atual do service worker é **versão 3**.

O worker:

- recebe o `userId` ativo na negociação de capability;
- associa o usuário ao `clientId`/aba;
- persiste o vínculo mínimo de escopo para sobreviver a suspensão/restart do worker;
- serializa trocas de identidade;
- só confirma capability depois de persistir o novo escopo;
- só serve `/offline-audio/<trackId>` para client com escopo válido;
- abre o cache da conta associada ao client, nunca um cache escolhido pela URL;
- mantém `/api/*` fora do cache estático da PWA.

Um worker antigo/incompatível degrada para offline indisponível até atualização, em vez de reutilizar um cache global legado.

## Cache legado

Versões anteriores usavam:

```text
home-music:offline-tracks:v1
home-music-offline-audio-v1
```

Como esses dados não registravam ownership, eles não são atribuídos automaticamente a uma conta na migração multiusuário. O comportamento seguro é exigir novo download.

## Limite de ciclo de vida

O scheduler executa `fetch()` e `cache.put()` no contexto ativo da aplicação. Por isso:

- trocar de tela dentro da SPA: **suportado**;
- recarregar/fechar a aba: pode interromper job em andamento;
- bloquear tela/background: depende de navegador e sistema operacional;
- download já concluído: permanece no cache até remoção pelo usuário/navegador.

Não anunciar continuidade de background como garantida até a validação da #81.

## Matriz mínima de validação mobile

| Plataforma | Cenário | Aceite |
| --- | --- | --- |
| Android/Chrome/PWA | iniciar arquivo grande e bloquear a tela | medir se terminou, pausou, retomou ou falhou sem corromper manifesto/cache |
| Android/Chrome/PWA | iniciar três downloads e enviar app para background | nenhum item pode aparecer concluído sem arquivo íntegro |
| iPhone/iPad/Safari/PWA | iniciar arquivo grande e bloquear a tela | medir comportamento real sem assumir execução contínua de JS |
| iPhone/iPad/Safari/PWA | alternar para outro app e retornar | cache e manifesto devem permanecer consistentes após suspensão |

Se uma plataforma não mantiver execução, a solução futura deve priorizar retomada/integridade, não simular continuidade.

## Fronteira local

O isolamento multiusuário evita vazamento durante uso normal do mesmo origin: login/logout, troca de conta, reload, múltiplas abas e modo offline.

Cache Storage e `localStorage` ainda pertencem ao perfil do navegador. Isso não é uma fronteira criptográfica contra alguém que controla DevTools ou o armazenamento local do dispositivo.

## Próxima etapa: coleções offline

A issue [#174](https://github.com/felipe-urgal/home-music/issues/174) registra a evolução para **playlist inteira e pasta inteira offline**.

Invariante já decidido para esse trabalho:

```text
uma faixa física no cache
        ↓
0..N referências lógicas
├── download individual
├── playlist A
├── playlist B
└── pasta X
```

A mesma música não deverá ocupar espaço duas vezes só porque participa de várias coleções. Remover uma playlist/pasta offline só poderá remover o arquivo físico quando nenhuma outra referência depender dele.

Essa funcionalidade ainda não está implementada e deve reutilizar o scheduler/cache atual.
