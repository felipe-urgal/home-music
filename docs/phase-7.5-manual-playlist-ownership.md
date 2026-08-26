# Fase 7.5 — Ownership de playlists manuais

Esta etapa separa playlists pessoais por usuário sem transformar as playlists importadas do Rekordbox em dados pessoais.

## Regra de ownership

- playlists `manual` pertencem exatamente a um usuário;
- playlists `rekordbox` continuam compartilhadas entre todos os usuários autenticados;
- o cliente nunca informa `userId` para operações de playlist;
- o backend deriva o dono exclusivamente de `request.user.id`;
- uma playlist manual de outra conta é tratada como inexistente (`404`) nas rotas por ID;
- playlists Rekordbox são somente leitura nas rotas normais de playlist e só mudam pela reimportação administrativa do XML.

## Schema v9

A tabela `playlists` recebe `owner_user_id`, com foreign key para `users(id)` e `ON DELETE CASCADE`.

A coluna é propositalmente nullable porque playlists Rekordbox são compartilhadas. A invariável é reforçada por triggers SQLite:

- `source = 'manual'` exige `owner_user_id IS NOT NULL`;
- `source = 'rekordbox'` exige `owner_user_id IS NULL`;
- outros valores de `source` são rejeitados.

O índice `idx_playlists_owner_source_updated` dá suporte à listagem das playlists pessoais sem misturar contas.

## Migration de playlists existentes

Quando já existe pelo menos uma conta, todas as playlists manuais antigas ainda sem dono são atribuídas deterministicamente à primeira conta criada, por `created_at ASC, id ASC`. A role atual não interfere nessa escolha.

IDs, nomes, timestamps e as linhas de `playlist_tracks` são preservados. Playlists Rekordbox permanecem com `owner_user_id = NULL` e continuam compartilhadas.

## Upgrade antes do primeiro bootstrap

O schema pode ser migrado antes de o primeiro administrador ser criado. Para não manter uma playlist manual ativa sem dono, a migration move temporariamente os dados para:

- `legacy_manual_playlists_pending`;
- `legacy_manual_playlist_tracks_pending`.

A cópia para staging acontece antes da remoção da playlist ativa. Como `playlist_tracks` usa `ON DELETE CASCADE`, as faixas ativas são removidas somente depois de já terem sido copiadas para o staging.

No bootstrap do primeiro administrador, playlists e faixas pendentes são reivindicadas na mesma transação usada para os demais dados pessoais legados. O bootstrap também recupera staging pendente quando uma conta já existe.

## Consultas e mutações

`HomeMusicDatabase` passa a exigir `userId` para operações manuais:

- `getPlaylists(userId)` retorna as playlists manuais daquele usuário mais todas as Rekordbox;
- `getPlaylistSource(userId, id)` não revela playlist manual de outra conta;
- `createPlaylist(userId, name)` grava o dono na criação;
- `renamePlaylist(userId, id, name)` atua somente na playlist manual do próprio usuário;
- `deletePlaylist(userId, id)` atua somente na playlist manual do próprio usuário;
- `setPlaylistTracks(userId, id, trackIds)` valida ownership no próprio SQL.

A sincronização `syncImportedPlaylists('rekordbox', ...)` continua global e administrativa.

## Rotas HTTP

As respostas consumidas pelo frontend continuam com o mesmo formato. A diferença é a seleção dos dados no backend.

- `GET /api/playlists` retorna manual do usuário atual + Rekordbox compartilhada;
- `POST /api/playlists` cria uma manual para o usuário atual;
- `PATCH /api/playlists/:id` só renomeia manual própria;
- `DELETE /api/playlists/:id` só remove manual própria;
- `PUT /api/playlists/:id/tracks` só altera manual própria.

As três mutações por ID devolvem `409` para playlist Rekordbox com a orientação de reimportar o XML. Antes desta etapa, a rota de `DELETE` ainda conseguia remover uma playlist Rekordbox; isso foi fechado.

## Segurança

O ownership é aplicado no SQL, não apenas em filtros depois da leitura. Assim, possuir ou adivinhar o ID de uma playlist de outra conta não concede acesso nem mutação.

Os triggers do banco são uma segunda barreira para evitar estados inválidos caso algum código futuro tente criar manual sem dono ou associar dono a uma playlist Rekordbox.

## Escopo posterior

Esta etapa não muda `playback_state`, downloads offline ou a política de login normal de contas secundárias. Esses itens continuam nas atividades seguintes da Fase 7.5.
