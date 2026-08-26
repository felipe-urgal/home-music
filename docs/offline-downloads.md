# Downloads offline

Este documento registra o comportamento atual dos downloads offline do Home Music e o ajuste de concorrência/navegação incluído junto da evolução multiusuário.

## Objetivo

Permitir iniciar mais de um download sem obrigar o usuário a permanecer na música ou tela em que o download começou.

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

O scheduler usa `trackId` como chave e deduplica pedidos concorrentes da mesma faixa. Clicar novamente ou reenviar a mesma operação enquanto o download está pendente/ativo reutiliza o mesmo job, em vez de baixar o arquivo duas vezes.

## Continuidade durante a navegação

`useOfflineDownloads()` é instanciado no `App` raiz e o scheduler vive fora das telas individuais.

Portanto, depois de iniciar um download, o usuário pode navegar entre:

- Player;
- Biblioteca;
- artistas/álbuns/pastas;
- playlists;
- estatísticas.

O job continua ativo e o conjunto `downloadingIds` permanece observável globalmente. Ao voltar para a faixa, a UI consegue continuar mostrando o estado de download.

Nenhum `AbortController` é associado à troca de tela.

## Limite de ciclo de vida

A continuidade garantida hoje é **dentro da mesma execução ativa da aplicação/aba**.

O scheduler fica em memória no contexto da página e cada job executa o `fetch()` e o `cache.put()` a partir do frontend. Portanto, navegar dentro da SPA é diferente de colocar o aplicativo em background ou bloquear a tela.

Fechar a aba, encerrar o navegador, recarregar a página ou o sistema operacional suspender o processo pode pausar ou interromper um download em andamento. Não devemos anunciar continuidade com tela bloqueada como garantia sem validação em dispositivo real.

Navegadores baseados em Chromium podem oferecer mecanismos específicos para downloads longos em background, mas essa capacidade não é uniforme entre plataformas. Em especial, o comportamento de PWA em iPhone/iPad precisa ser tratado como uma matriz própria de compatibilidade, não inferido do Android.

Os arquivos que já terminaram continuam persistidos normalmente no Cache Storage e no manifesto local.

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

Cada job continua:

1. baixando o arquivo completo por `/api/tracks/:id/stream`;
2. validando resposta HTTP `200`;
3. verificando espaço disponível quando o navegador oferece `navigator.storage.estimate()`;
4. gravando o áudio no Cache Storage;
5. atualizando o manifesto local somente depois do cache concluir;
6. tentando solicitar armazenamento persistente como operação best-effort.

Falha de quota continua sendo reportada sem registrar download incompleto como concluído.

## Multiusuário

O scheduler não altera o namespace atual do Cache Storage nem do manifesto.

A separação de downloads por `userId` continua como atividade própria da Fase 7.5, porque precisa ser coordenada com o login multiusuário e a limpeza de dados no mesmo navegador. Não antecipamos essa migration neste ajuste para evitar misturar identidades antes do restante do ownership estar pronto.
