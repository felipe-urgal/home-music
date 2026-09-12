# Composição da aplicação

A composição do frontend é separada em três níveis para manter sessão, navegação e playback com responsabilidades explícitas, sem criar fontes paralelas de estado.

## App

`App.tsx` é a raiz de sessão e conectividade. Ele:

- inicializa autenticação e downloads offline em paralelo;
- decide entre estado de sessão, login, indisponibilidade, aplicação autenticada e aplicação offline;
- controla a entrada/saída manual do modo offline por `offlineMode`;
- deriva a entrada automática diretamente de `auth.unreachable` + manifesto físico local não vazio, sem delegar essa decisão ao formulário de login;
- no cold start em que o navegador reporta ausência real de rede, reconcilia Cache Storage depois da montagem; quando há rede mas o servidor Home Music está inalcançável, reutiliza a reconciliação normal de `useOfflineDownloads`, evitando duas enumerações do mesmo cache;
- mantém `OfflineApp` no shell inicial para que um reload posterior sem rede não dependa de buscar código novo;
- não conhece shells, navegação interna da biblioteca nem estado de playback.

A entrada manual não cria uma segunda implementação de offline. `AuthenticatedApp` recebe apenas o callback `onOpenOffline` e os dados já produzidos por `useOfflineDownloads`; ao acioná-lo, a raiz desmonta a experiência online e monta o mesmo `OfflineApp` usado na indisponibilidade real do servidor.

Na inicialização automática, `App` também continua sendo a autoridade. Se o servidor estiver inalcançável e o manifesto físico do namespace local conhecido contiver downloads, `OfflineApp` é montado imediatamente com um snapshot que força `loading: false`, portanto a tela de preparação não fica presa à reconciliação física. A enumeração de Cache Storage ocorre fora do caminho crítico e possui um único responsável por cenário: `App` quando `navigator.onLine === false`, ou `useOfflineDownloads` quando existe conectividade de rede. Se a reconciliação concluir com sucesso, o snapshot da sessão é filtrado pelos bytes encontrados; se a própria enumeração falhar, o manifesto não é convertido em vazio. Se o servidor estiver inalcançável e o manifesto não tiver conteúdo offline, a aplicação mostra um estado explícito de indisponibilidade com ação de nova tentativa; o formulário de credenciais não é apresentado porque autenticar não resolveria uma falha de conectividade.

Essa separação é intencional: o manifesto é o índice de bootstrap, enquanto o service worker e o Cache Storage continuam sendo a autoridade para servir o áudio de cada faixa. Um falso positivo causado por eviction não produz áudio incorreto; a rota virtual devolve indisponibilidade para um blob ausente e a reconciliação posterior reduz o snapshot quando possível.

## AuthenticatedApp

`AuthenticatedApp.tsx` é a composição da experiência autenticada. Ele mantém juntas as fontes globais que precisam compartilhar ciclo de vida:

- `useLibraryData` para biblioteca e playlists;
- `useLibraryNavigation` e `useRoutedScreen` para navegação autenticada;
- `useCrossfadeAudioPlayer` como camada de transição sobre o `useAudioPlayer`, que continua sendo a fonte canônica do playback online;
- continuidade, preload, qualidade de rede e preferência de volume;
- composição dos shells e superfícies mobile/desktop;
- disponibilização, para `MyAccountScreen`, do estado derivado dos downloads e do callback de entrada manual no modo offline.

Extrair esses hooks para stores ou contexts independentes sem uma necessidade concreta voltaria a espalhar o estado global e não faz parte desta arquitetura.

## OfflineApp

`OfflineApp.tsx` compõe a experiência isolada de downloads offline. Ele mantém:

- navegação local entre biblioteca offline e player;
- uma instância de `useCrossfadeAudioPlayer` com `offlineMode: true`, reutilizando o mesmo `useAudioPlayer` canônico e resolvendo os decks pela rota `/offline-audio/<trackId>`;
- continuidade de reprodução offline e fallback para troca normal quando crossfade não pode ser mantido;
- shell e barra do player reutilizados pela experiência principal;
- uma marca de superfície `phone-surface--offline` usada para diferenças responsivas estritamente próprias do modo offline, como manter `Voltar aos downloads` visível no player mobile;
- saída pelo mesmo callback de `App.tsx`, que restaura a experiência online e refaz a verificação de autenticação/conectividade.

O player offline é deliberadamente separado do player autenticado porque opera com outra coleção e outra persistência, mas cada modo continua tendo uma única fonte de verdade. O crossfade não cria estado paralelo de playback: o segundo deck é somente uma transição temporária e é adotado pelo `useAudioPlayer` no handoff.

A biblioteca offline também limita a montagem inicial dos downloads individuais a 100 linhas. `Mostrar mais` expande em blocos de 100, enquanto a fila passada ao player continua completa. Essa paginação é responsabilidade da própria superfície offline e não cria outra fonte de dados.

## Entrada manual no modo offline

Enquanto autenticado e conectado, a conta exibe `Preferências → Modo offline`.

A ação:

- usa exatamente os downloads físicos já reconciliados por `useOfflineDownloads`;
- fica desabilitada enquanto o estado offline está carregando, quando o navegador não suporta a funcionalidade ou quando não existe nenhuma música salva;
- não simula `navigator.onLine`, não bloqueia a rede globalmente e não altera o estado do servidor;
- apenas troca a superfície ativa para a experiência offline real, garantindo que reprodução e navegação usem somente o conteúdo salvo neste dispositivo.

## Regras

- `App.tsx` não deve voltar a concentrar composição interna de biblioteca/player;
- `LoginScreen` não decide entrada automática no modo offline e não deve virar um segundo controlador dessa transição;
- estado de biblioteca, navegação ou playback não deve ser duplicado entre `App`, `AuthenticatedApp` e seus componentes filhos;
- diferenças mobile/desktop continuam pertencendo aos shells e superfícies responsáveis, não à raiz de sessão;
- novas abstrações compartilhadas só devem ser introduzidas quando reduzirem acoplamento real;
- mudanças de composição devem preservar autenticação, deep links, retomada do player, modo offline e comportamento responsivo;
- qualquer nova entrada para o modo offline deve reutilizar `App.tsx` como autoridade e `OfflineApp` como implementação, sem criar flags paralelas;
- resposta válida do servidor informando sessão inválida continua exigindo autenticação online; indisponibilidade de transporte pode liberar somente o conteúdo local já associado ao namespace conhecido.

Este desenho corresponde ao refactor comportamentalmente neutro da issue #115 e à evolução posterior de entrada manual e bootstrap offline das issues #258, #259 e #328.
