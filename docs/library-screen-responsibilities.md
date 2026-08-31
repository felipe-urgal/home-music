# Responsabilidades da LibraryScreen

A `LibraryScreen` é o orquestrador da biblioteca. Ela conecta dados, navegação, ações e superfícies visuais sem duplicar o estado canônico mantido por `useLibraryData` e `useLibraryNavigation`.

## Limites

- `LibraryNavigationChrome`: cabeçalho, breadcrumbs e tabs da biblioteca.
- `LibraryViewTools`: busca, ordenação, filtros e views salvas.
- `LibraryContent`: superfícies de pastas, lista de playlists e detalhe de playlist.
- `LibraryTrackRows`: apresentação de faixas, incluindo a adaptação mobile/desktop.
- `LibraryScreen`: coordena prompts/confirmações, ações de dados, mini player e diálogo de playlist inteligente.

## Regras

- não manter cópias locais de seleção, busca, filtros ou paginação;
- preservar classes, labels e semântica acessível das superfícies existentes;
- manter a decisão mobile/desktop encapsulada na apresentação de faixas;
- mudanças futuras devem entrar no componente/hook responsável em vez de crescer novamente o orquestrador.

Este desenho é um refactor comportamentalmente neutro da entrega da issue #113.
