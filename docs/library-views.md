# Views inteligentes da biblioteca

As views inteligentes permitem salvar uma combinação pessoal de busca, filtros e ordenação da biblioteca sem criar uma playlist nem copiar IDs de músicas.

## Modelo

Cada view pertence a um usuário autenticado e persiste somente:

- texto de busca;
- formato (`all` ou o formato selecionado);
- filtro de capa (`all`, `with-cover`, `without-cover`);
- ordenação (`current`, título, artista ou álbum em ordem crescente/decrescente).

A view **não** persiste `trackIds`. Quando é aberta, a definição é aplicada novamente sobre a biblioteca atual. Assim, faixas novas podem aparecer automaticamente e faixas removidas deixam de aparecer sem reconciliação específica da view.

## Fonte única de filtragem

O frontend continua usando `useLibraryNavigation` + `library-utils` como fonte única para busca, filtros e ordenação. O backend valida e persiste a definição, mas não mantém uma segunda implementação do motor de filtro.

Ao abrir uma view, filtros compatíveis são reaplicados. Se o formato salvo não existir no contexto atual, o frontend volta somente esse filtro para `all`; busca, capa e ordenação continuam preservadas.

## Persistência e ownership

A tabela `library_views` é criada de forma idempotente no SQLite e referencia `users(id)` com `ON DELETE CASCADE`.

Todas as operações usam o usuário da sessão como boundary de ownership. A API nunca aceita `userId` arbitrário do cliente.

Rotas:

- `GET /api/library-views` — lista as views do usuário atual;
- `POST /api/library-views` — cria uma view;
- `PATCH /api/library-views/:id` — renomeia ou atualiza a definição;
- `DELETE /api/library-views/:id` — exclui a view.

As mutações continuam sujeitas ao header obrigatório `X-Home-Music-Request: 1` pela política global de autenticação.

## UX

Na biblioteca, busca e filtros ficam em um controle compacto. Views já salvas aparecem em uma faixa curta para abertura rápida. Criar, renomear e excluir permanecem no painel expandido para evitar poluir a navegação principal.

O mesmo fluxo é usado em mobile e desktop, com layout fluido, foco visível e botões adequados para toque.

## Relação com smart playlists

Smart playlists (#108) e views inteligentes (#109) são conceitos diferentes:

- smart playlist é uma coleção dinâmica por regras de biblioteca/histórico/favoritos;
- view inteligente é uma configuração reutilizável da navegação e dos filtros da biblioteca.

Ambas persistem definições em vez de materializar faixas, mas uma view não é armazenada como `playlist` e não participa de `playlist_tracks`.

## Testes mínimos

A entrega mantém regressões para:

- persistência após reabrir o SQLite;
- isolamento entre usuários;
- autenticação obrigatória;
- header de mutação obrigatório;
- payload inválido;
- tentativas de renomear/excluir uma view de outro usuário.
