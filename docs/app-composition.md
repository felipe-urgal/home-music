# Composição da aplicação

A composição do frontend mantém sessão, navegação e playback com responsabilidades explícitas, sem criar fontes paralelas de estado.

## App

`App.tsx` é a raiz de sessão e conectividade. Ele:

- inicializa autenticação e downloads offline em paralelo;
- decide entre loading de sessão, login, aplicação autenticada, aplicação offline e superfície remota;
- controla entrada/saída manual do modo offline;
- deriva a entrada offline automática de `auth.unreachable` + manifesto físico local;
- no cold start realmente offline, reconcilia Cache Storage fora do caminho crítico;
- mantém `OfflineApp` no shell inicial;
- não conhece composição interna de biblioteca/player.

A ordem é importante. Depois de resolver autenticação/offline, `App` examina a URL autenticada. Uma rota válida `/remote/<sessionId>` monta `TvRemoteControlScreen` **antes** de `AuthenticatedApp`. Dessa forma o celular reutiliza sessão/autenticação da raiz, mas não inicializa biblioteca nem player online e não cria `<audio>`.

Rotas normais continuam montando `AuthenticatedApp`.

## AuthenticatedApp

`AuthenticatedApp.tsx` é a composição da experiência autenticada e mantém juntas as fontes globais que compartilham ciclo de vida:

- `useLibraryData` para biblioteca/playlists;
- `useLibraryNavigation` e `useRoutedScreen` para navegação;
- `useCrossfadeAudioPlayer` sobre o `useAudioPlayer` canônico;
- continuidade, preload, qualidade de rede e preferência de volume;
- shells e superfícies mobile/desktop/TV;
- dados/callback de entrada manual no modo offline;
- `useTvRemoteSession`, que recebe estado/callbacks do player existente e só cria uma sessão remota após a ação explícita **Controle pelo celular** no modo TV.

O controle remoto não adiciona um segundo player. `useTvRemoteSession` deriva snapshots do mesmo `useCrossfadeAudioPlayer` e converte comandos remotos para `togglePlay`, `previous`, `next` e `seek` já existentes.

O botão remoto é composto apenas na experiência TV. O overlay pode ser escondido sem destruir a sessão; gerar novo código substitui a sessão anterior. No unmount da experiência autenticada, o hook tenta encerrar a sessão com DELETE best-effort.

Extrair esses hooks para stores/contexts independentes sem necessidade concreta voltaria a espalhar estado global e não faz parte desta arquitetura.

## Superfície `/remote/<sessionId>`

`authenticatedSurfaceForPath` separa a rota remota do roteamento interno comum. O `sessionId` é um segmento opaco com encode/decode explícito.

`TvRemoteControlScreen`:

- valida a sessão remota autenticada;
- abre SSE para snapshots/fechamento;
- mostra conexão, faixa e progresso;
- envia comandos serializados;
- nunca monta `AuthenticatedApp`, `useAudioPlayer` ou `<audio>`.

O telefone é um controle do player da TV, não outra superfície de reprodução.

## OfflineApp

`OfflineApp.tsx` compõe a experiência isolada de downloads offline. Ele mantém:

- navegação local entre biblioteca offline e player;
- uma instância de `useCrossfadeAudioPlayer` com `offlineMode: true` e decks pela rota `/offline-audio/<trackId>`;
- continuidade de reprodução offline e fallback de transição;
- shell/barra do player reutilizados;
- `phone-surface--offline` para diferenças responsivas próprias do modo;
- saída pelo callback de `App.tsx`, que restaura a experiência online e refaz a verificação de autenticação/conectividade.

O player offline é separado porque opera com outra coleção/persistência, mas cada modo mantém uma única fonte de verdade. O segundo deck de crossfade é somente transição temporária e é adotado pelo `useAudioPlayer` no handoff.

A biblioteca offline limita a montagem inicial dos downloads individuais a 100 linhas. `Mostrar mais` expande em blocos de 100, enquanto a fila do player continua completa.

## Entrada manual no modo offline

Enquanto autenticado e conectado, a conta exibe `Preferências → Modo offline`.

A ação:

- usa os downloads físicos reconciliados por `useOfflineDownloads`;
- fica desabilitada durante loading, sem suporte do navegador ou sem música salva;
- não simula `navigator.onLine`, não bloqueia rede e não altera servidor;
- troca a superfície ativa para a implementação real de `OfflineApp`.

## Regras

- `App.tsx` não deve concentrar composição interna de biblioteca/player;
- `LoginScreen` não decide entrada automática no modo offline;
- biblioteca, navegação e playback não devem ser duplicados entre `App`, `AuthenticatedApp` e filhos;
- `/remote/<sessionId>` deve continuar acima de `AuthenticatedApp` para impedir áudio local no controlador;
- o controle remoto da TV deve usar o player canônico, nunca uma store paralela;
- diferenças mobile/desktop/TV pertencem às superfícies responsáveis;
- mudanças de composição devem preservar autenticação, deep links, retomada do player, offline e comportamento responsivo;
- resposta válida do servidor informando sessão inválida continua exigindo autenticação online; indisponibilidade de transporte pode liberar somente conteúdo local associado ao namespace conhecido.

Este desenho corresponde ao refactor da issue #115, às evoluções offline #258/#259/#328 e ao controle remoto TV implementado pelo PR #393.
