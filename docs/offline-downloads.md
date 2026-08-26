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

A continuidade garantida é **dentro da mesma execução da aplicação/aba**.

Fechar a aba, encerrar o navegador, recarregar a página ou o sistema operacional suspender o processo pode interromper um download em andamento. Tornar jobs sobreviventes a reload exigiria outra estratégia apoiada por Service Worker/Background Fetch e tem suporte inconsistente, especialmente em Safari/iOS.

Os arquivos que já terminaram continuam persistidos normalmente no Cache Storage e no manifesto local.

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
