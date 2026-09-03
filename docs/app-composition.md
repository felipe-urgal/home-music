# Composição da aplicação

A composição do frontend é separada em três níveis para manter sessão, navegação e playback com responsabilidades explícitas, sem criar fontes paralelas de estado.

## App

`App.tsx` é a raiz de sessão e conectividade. Ele:

- inicializa autenticação e downloads offline em paralelo;
- decide entre estado de sessão, login, indisponibilidade, aplicação autenticada e aplicação offline;
- controla a entrada/saída manual do modo offline por `offlineMode`;
- deriva a entrada automática diretamente de `auth.unreachable` + downloads físicos reconciliados, sem delegar essa decisão ao formulário de login;
- aquece o chunk lazy do `OfflineApp` enquanto existe uma sessão online autenticada e o suporte offline está pronto, para que um reload posterior sem rede não dependa de buscar código novo;
- não conhece shells, navegação interna da biblioteca nem estado de playback.

A entrada manual não cria uma segunda implementação de offline. `AuthenticatedApp` recebe apenas o callback `onOpenOffline` e os dados já produzidos por `useOfflineDownloads`; ao acioná-lo, a raiz desmonta a experiência online e monta o mesmo `OfflineApp` usado na indisponibilidade real do servidor.

Na inicialização automática, `App` também continua sendo a autoridade. Se o servidor estiver inalcançável e existirem downloads válidos para o namespace local conhecido, `OfflineApp` é montado diretamente. Se o servidor estiver inalcançável e nenhum conteúdo offline puder ser aberto, a aplicação mostra um estado explícito de indisponibilidade com ação de nova tentativa; o formulário de credenciais não é apresentado porque autenticar não resolveria uma falha de conectividade.

## AuthenticatedApp

`AuthenticatedApp.tsx` é a composição da experiência autenticada. Ele mantém juntas as fontes globais que precisam compartilhar ciclo de vida:

- `useLibraryData` para biblioteca e playlists;
- `useLibraryNavigation` e `useRoutedScreen` para navegação autenticada;
- `useAudioPlayer` como fonte canônica do playback online;
- continuidade, preload, qualidade de rede e preferência de volume;
- composição dos shells e superfícies mobile/desktop;
- disponibilização, para `MyAccountScreen`, do estado derivado dos downloads e do callback de entrada manual no modo offline.

Extrair esses hooks para stores ou contexts independentes sem uma necessidade concreta voltaria a espalhar o estado global e não faz parte desta arquitetura.

## OfflineApp

`OfflineApp.tsx` compõe a experiência isolada de downloads offline. Ele mantém:

- navegação local entre biblioteca offline e player;
- uma instância de `useAudioPlayer` com `offlineMode: true`;
- continuidade de reprodução offline;
- shell e barra do player reutilizados pela experiência principal;
- saída pelo mesmo callback de `App.tsx`, que restaura a experiência online e refaz a verificação de autenticação/conectividade.

O player offline é deliberadamente separado do player autenticado porque opera com outra coleção e outra persistência, mas cada modo continua tendo uma única fonte de verdade.

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

Este desenho corresponde ao refactor comportamentalmente neutro da issue #115 e à evolução posterior de entrada manual e bootstrap offline das issues #258 e #259.
