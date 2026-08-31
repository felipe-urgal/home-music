# Composição da aplicação

A composição do frontend é separada em três níveis para manter sessão, navegação e playback com responsabilidades explícitas, sem criar fontes paralelas de estado.

## App

`App.tsx` é a raiz de sessão e conectividade. Ele:

- inicializa autenticação e downloads offline;
- decide entre estado de sessão, login, aplicação autenticada e aplicação offline;
- controla somente a entrada/saída do modo offline e sua abertura automática quando o servidor está inacessível;
- não conhece shells, navegação interna da biblioteca nem estado de playback.

## AuthenticatedApp

`AuthenticatedApp.tsx` é a composição da experiência autenticada. Ele mantém juntas as fontes globais que precisam compartilhar ciclo de vida:

- `useLibraryData` para biblioteca e playlists;
- `useLibraryNavigation` e `useRoutedScreen` para navegação autenticada;
- `useAudioPlayer` como fonte canônica do playback online;
- continuidade, preload, qualidade de rede e preferência de volume;
- composição dos shells e superfícies mobile/desktop.

Extrair esses hooks para stores ou contexts independentes sem uma necessidade concreta voltaria a espalhar o estado global e não faz parte desta arquitetura.

## OfflineApp

`OfflineApp.tsx` compõe a experiência isolada de downloads offline. Ele mantém:

- navegação local entre biblioteca offline e player;
- uma instância de `useAudioPlayer` com `offlineMode: true`;
- continuidade de reprodução offline;
- shell e barra do player reutilizados pela experiência principal.

O player offline é deliberadamente separado do player autenticado porque opera com outra coleção e outra persistência, mas cada modo continua tendo uma única fonte de verdade.

## Regras

- `App.tsx` não deve voltar a concentrar composição interna de biblioteca/player;
- estado de biblioteca, navegação ou playback não deve ser duplicado entre `App`, `AuthenticatedApp` e seus componentes filhos;
- diferenças mobile/desktop continuam pertencendo aos shells e superfícies responsáveis, não à raiz de sessão;
- novas abstrações compartilhadas só devem ser introduzidas quando reduzirem acoplamento real;
- mudanças de composição devem preservar autenticação, deep links, retomada do player, modo offline e comportamento responsivo.

Este desenho corresponde ao refactor comportamentalmente neutro da issue #115.
