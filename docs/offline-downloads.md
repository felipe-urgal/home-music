# Downloads offline

Este documento registra o comportamento atual dos downloads offline do Home Music, incluindo concorrência, limites de background e isolamento entre contas no mesmo navegador.

## Objetivo

Permitir iniciar mais de um download sem obrigar o usuário a permanecer na música ou tela em que o download começou, mantendo os dados locais associados ao usuário autenticado que criou o download.

## Scheduler global

Os downloads usam um scheduler global do frontend com limite de **3 operações simultâneas**.

Quando há mais de três pedidos:

```text
download A ─ ativo
download B ─ ativo
download C ─ ativo
download D ─ aguardando
download E ─ aguardando
```

Assim evitamos abrir conexões ilimitadas contra o servidor e ainda permitimos paralelismo útil em Wi-Fi/rede local.

A chave interna do scheduler inclui `userId + trackId`. Isso preserva a deduplicação da mesma faixa para a mesma conta sem fazer um download iniciado por A bloquear ou contaminar uma operação equivalente de B.

## Continuidade durante a navegação

`useOfflineDownloads()` é instanciado no `App` raiz e o scheduler vive fora das telas individuais.

Portanto, depois de iniciar um download, o usuário pode navegar entre:

- Player;
- Biblioteca;
- artistas/álbuns/pastas;
- playlists;
- estatísticas.

O job continua ativo e o conjunto `downloadingIds` permanece observável para o usuário atual. Ao voltar para a faixa, a UI consegue continuar mostrando o estado de download.

Nenhum `AbortController` é associado à troca de tela.

## Limite de ciclo de vida

A continuidade garantida hoje é **dentro da mesma execução ativa da aplicação/aba**.

O scheduler fica em memória no contexto da página e cada job executa o `fetch()` e o `cache.put()` a partir do frontend. Portanto, navegar dentro da SPA é diferente de colocar o aplicativo em background ou bloquear a tela.

Fechar a aba, encerrar o navegador, recarregar a página ou o sistema operacional suspender o processo pode pausar ou interromper um download em andamento. Não devemos anunciar continuidade com tela bloqueada como garantia sem validação em dispositivo real.

Navegadores baseados em Chromium podem oferecer mecanismos específicos para downloads longos em background, mas essa capacidade não é uniforme entre plataformas. Em especial, o comportamento de PWA em iPhone/iPad precisa ser tratado como uma matriz própria de compatibilidade, não inferido do Android.

Os arquivos que já terminaram continuam persistidos normalmente no Cache Storage e no manifesto local do usuário correspondente.

## Validação mobile de background/tela bloqueada

Antes de considerar continuidade em background como funcionalidade concluída, executar em aparelhos reais pelo menos estes cenários:

| Plataforma | Cenário | Aceite |
| --- | --- | --- |
| Android/Chrome ou PWA instalada | iniciar arquivo suficientemente grande, bloquear a tela durante o download e desbloquear depois | verificar se o arquivo terminou íntegro; se não, registrar se pausou, retomou ou falhou |
| Android/Chrome ou PWA instalada | iniciar três downloads, enviar app para background e retornar | nenhum item pode ser anunciado como concluído sem existir integralmente no Cache Storage |
| iPhone/iPad/Safari ou PWA instalada | iniciar arquivo suficientemente grande, bloquear a tela e desbloquear depois | medir o comportamento real sem assumir execução contínua do JavaScript |
| iPhone/iPad/Safari ou PWA instalada | alternar para outro app por alguns minutos e retornar | manifesto e cache devem permanecer consistentes mesmo quando o sistema suspender a página |

Se o download não sobreviver ao bloqueio em uma plataforma, a próxima solução deve priorizar integridade e retomada explícita em vez de fingir execução contínua. Qualquer estratégia de background precisa degradar com segurança onde a API necessária não existir.

## Armazenamento

Cada job:

1. captura o `userId` que iniciou a operação;
2. baixa o arquivo completo por `/api/tracks/:id/stream` usando a sessão atual;
3. valida resposta HTTP `200`;
4. verifica espaço disponível quando o navegador oferece `navigator.storage.estimate()`;
5. grava o áudio no Cache Storage exclusivo daquele `userId`;
6. atualiza somente o manifesto daquele `userId` depois que o cache conclui;
7. tenta solicitar armazenamento persistente como operação best-effort.

Falha de quota continua sendo reportada sem registrar download incompleto como concluído.

Uma troca de conta durante um download não move o resultado para a nova conta: o job mantém o `userId` capturado no início e qualquer conclusão tardia permanece no namespace original.

## Isolamento multiusuário

O navegador possui um único origin para o Home Music, portanto o isolamento precisa ser explícito na aplicação.

O estado atual usa:

```text
home-music:offline-user-id:v1
home-music:offline-tracks:v2:<userId>
home-music-offline-audio-v2-<userId>
/offline-audio/<trackId>
```

A identidade offline ativa é atualizada somente depois que `/api/auth/status` confirma um usuário autenticado. Ela é removida quando:

- o servidor confirma que não há sessão autenticada;
- a sessão expira e uma API devolve `401`;
- o usuário conclui logout;
- a verificação de autenticação alcança o servidor, mas falha de forma que a identidade não possa ser confirmada.

Quando o servidor está realmente inalcançável, o último `userId` autenticado pode continuar sendo usado para abrir **somente os downloads daquele namespace**. Isso preserva o modo offline sem permitir que uma troca A → B reutilize o manifesto/cache de A pela UI normal.

A troca de usuário é fail-closed em dois níveis:

1. enquanto o hook ainda não carregou o novo manifesto, a lista visível fica vazia em vez de reutilizar registros do usuário anterior;
2. enquanto o service worker ainda não confirmou o novo escopo do client/tab, reprodução offline permanece indisponível.

O `userId` não é aceito como parte da URL de áudio offline e portanto não funciona como autorização por identificador. A rota virtual identifica somente a faixa; o service worker seleciona o cache usando o usuário associado ao `clientId` que originou a requisição.

### Cache e manifesto legados

A versão anterior usava um manifesto e um cache globais:

```text
home-music:offline-tracks:v1
home-music-offline-audio-v1
```

Esses dados não registram qual conta os criou. Por isso **não são migrados automaticamente** para o primeiro usuário que abrir a versão nova. A versão multiusuário remove manifesto e cache legados e exige baixar novamente as músicas desejadas.

Adotar o cache antigo para o usuário atual seria uma atribuição de ownership sem evidência e poderia transformar a migration em vazamento entre contas.

### Limite da fronteira local

O objetivo desta separação é impedir vazamento entre contas durante o uso normal da aplicação no mesmo perfil do navegador: troca de login, logout, sessão expirada, reload e modo offline.

Cache Storage e `localStorage` continuam pertencendo ao mesmo origin do navegador. Eles não são uma fronteira criptográfica contra alguém que já tenha controle irrestrito do perfil local, DevTools ou armazenamento do dispositivo. Uma ameaça local desse nível exigiria criptografia de conteúdo/chaves por usuário e um modelo de desbloqueio offline próprio, o que não faz parte desta etapa.

## Service worker

O protocolo de capability do service worker foi elevado para a versão `3`.

A nova versão:

- recebe do frontend o `userId` ativo junto da negociação de capability;
- associa esse usuário ao `clientId`/tab que enviou a mensagem;
- só serve `/offline-audio/<trackId>` quando a requisição vem de um client com escopo válido;
- abre o cache do usuário associado ao client, nunca um cache escolhido por parâmetro da URL;
- remove o cache global legado durante a ativação;
- continua mantendo conteúdo autenticado de `/api/*` fora do cache estático da PWA.

O frontend considera o worker pronto para offline somente depois da resposta à negociação correspondente ao `userId` atual. Um service worker antigo (`version < 3`) degrada para offline indisponível até o upgrade, em vez de reutilizar o cache global anterior.
