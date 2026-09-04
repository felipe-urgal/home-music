# OpenSubsonic

Esta página define o subset OpenSubsonic suportado pelo Home Music na Fase 13 e, principalmente, a fronteira arquitetural do adapter.

> Regra: **OpenSubsonic é somente um adapter de protocolo**. Biblioteca, usuários, favoritos, playlists, histórico, streaming e filesystem continuam tendo a mesma autoridade usada pelo frontend Home Music.

## Clientes-alvo

O subset inicial é guiado por clientes reais que já suportam servidores OpenSubsonic/Subsonic:

- **Symfonium** — alvo mobile principal;
- **Feishin** — alvo desktop principal;
- **Tempo/Tempus** — terceiro alvo de compatibilidade para smoke manual quando aplicável.

O CI não instala nem depende desses aplicativos. Compatibilidade automatizada usa cliente HTTP/fixtures locais e os clientes reais entram apenas na validação manual documentada.

## Autenticação

O adapter **não reutiliza cookie, sessão ou senha web** como credencial genérica de cliente externo.

A integração usa a extensão OpenSubsonic `apiKeyAuthentication`:

- a chave é criada em **Minha conta** pelo próprio usuário autenticado;
- o valor em claro é mostrado somente no momento da criação;
- o SQLite guarda somente SHA-256 da chave e um hint não sensível;
- cada chave pertence a um `userId` imutável;
- listar/revogar uma chave sempre deriva ownership da sessão web atual;
- chamadas `/rest/*` derivam ownership exclusivamente da chave autenticada;
- revogar a chave não revoga a sessão web;
- usuário desabilitado ou com troca obrigatória de senha deixa de autenticar pelo adapter;
- senha/token-salt legado de Subsonic não é aceito pelo subset inicial.

Como a chave OpenSubsonic é transportada em query parameter pelo protocolo, o logger HTTP do servidor deve remover a query string antes de registrar a URL de request.

## Matriz endpoint → autoridade Home Music

Esta matriz existe **antes dos handlers** para impedir a criação acidental de uma segunda fonte de verdade.

| Endpoint OpenSubsonic | Autoridade/serviço Home Music | Regra do adapter |
| --- | --- | --- |
| `ping` | composição do servidor | somente envelope/versionamento |
| `getOpenSubsonicExtensions` | contrato do adapter | público; anuncia apenas extensions realmente implementadas |
| `tokenInfo` | credenciais OpenSubsonic + usuário persistido | resolve a API key sem expor hash/token |
| `getMusicFolders` | `LibraryService` | uma biblioteca lógica; nenhum path físico |
| `getIndexes` | `LibraryService.listPublicTracks()` | projeção de artistas sobre o snapshot atual |
| `getArtists` | `LibraryService.listPublicTracks()` | agregação somente em memória, sem segundo índice persistente |
| `getArtist` | `LibraryService.listPublicTracks()` | ID opaco derivado da projeção canônica |
| `getAlbumList2` | `LibraryService.listPublicTracks()` | apenas ordenações com semântica disponível no snapshot |
| `getAlbum` | `LibraryService.listPublicTracks()` | álbum projetado; faixas continuam sendo as mesmas tracks |
| `getSong` | `LibraryService.getTrack()` + projeção pública | nunca inclui `filePath`/path físico |
| `getMusicDirectory` | `LibraryService.listPublicTracks()` | navegação lógica artista → álbum → faixa |
| `search3` | `LibraryService.listPublicTracks()` | busca sobre o snapshot vigente; query vazia é aceita para sync |
| `stream` | `TrackMediaInfrastructure` | usa o mesmo confinement/arquivo regular/Range/transcoding disponível |
| `getCoverArt` | `TrackMediaInfrastructure.cover()` | artwork por ID opaco; nenhum path físico |
| `getLyricsBySongId` | `TrackMediaInfrastructure.lyrics()` | adapta a resposta existente; nenhuma leitura paralela de filesystem |
| `getPlaylists` | `PersonalLibraryService.getPlaylists(userId)` | somente o usuário derivado da chave |
| `getPlaylist` | `PersonalLibraryService.getPlaylists(userId)` | playlist de outro usuário equivale a não encontrada |
| `createPlaylist` | `PersonalLibraryService.createPlaylist()` / `setPlaylistTracks()` | backend revalida nome/faixas |
| `updatePlaylist` | `PersonalLibraryService.renamePlaylist()` / `setPlaylistTracks()` | somente playlist manual do owner |
| `deletePlaylist` | `PersonalLibraryService.deletePlaylist()` | somente playlist manual do owner |
| `getStarred2` | `PersonalLibraryService.getFavoriteIds(userId)` | favoritos do owner autenticado |
| `star` / `unstar` | `PersonalLibraryService.setFavorite()` | somente faixa existente e owner autenticado |
| `scrobble` | histórico pessoal já persistido no SQLite | grava somente submission real; now-playing não cria estado paralelo |

Endpoints fora desta matriz retornam erro OpenSubsonic explícito de não suportado. O adapter não simula sucesso para capacidade ausente.

## IDs do protocolo

`track.id` do Home Music permanece o ID da música.

Artistas e álbuns recebem IDs opacos e determinísticos derivados da projeção canônica atual. Esses IDs existem somente no adapter e **não formam um segundo catálogo persistido**.

Artwork referencia uma faixa existente que possui capa. O identificador externo nunca contém caminho de arquivo.

## Streaming

O adapter abre mídia exclusivamente por `TrackMediaInfrastructure`, que já revalida:

- existência da faixa habilitada;
- confinement em `MUSIC_DIR`;
- arquivo regular;
- mudanças relevantes antes do transcoding.

HTTP Range preserva `206`, `Content-Range`, `Content-Length` e `416` usando a mesma regra da API nativa. Quando um parâmetro OpenSubsonic puder ser mapeado sem ambiguidade para um perfil de transcoding Home Music, o adapter delega para a infraestrutura existente; caso contrário mantém o original em vez de inventar uma qualidade.

## Segurança e isolamento

- `/rest/*` não passa pelo cookie web; autentica pela API key dedicada;
- `username`, IDs de playlist e demais parâmetros do cliente nunca substituem a identidade autenticada;
- não existe superfície administrativa OpenSubsonic no subset inicial;
- erros públicos não incluem stack, path, query secreta, hash ou token;
- chamadas inválidas/credenciais inválidas possuem rate limit local e falham sem enumeração de usuários;
- nenhuma resposta de biblioteca expõe `filePath`, `MUSIC_DIR` ou path absoluto;
- nenhuma mutação confia em validação do cliente;
- SQLite e scanner continuam únicos.

## Compatibilidade automatizada

A suíte do servidor deve cobrir pelo menos:

1. capabilities públicas sem credencial;
2. chave válida, inválida e revogada;
3. listagem de biblioteca e busca;
4. Range de streaming;
5. artwork/lyrics sem path físico;
6. playlist/favorito/scrobble derivados do owner autenticado;
7. tentativa cross-user/IDOR;
8. endpoint não suportado retornando falha explícita;
9. ausência de rede pública no teste.

## Matriz de validação manual

Esta tabela deve ser preenchida com evidência real antes de fechar #264.

| Cliente | Plataforma | Autentica | Lista biblioteca | Reproduz áudio | Observações |
| --- | --- | --- | --- | --- | --- |
| Symfonium | Android | pendente | pendente | pendente | alvo mobile principal |
| Feishin | desktop | pendente | pendente | pendente | alvo desktop principal |
| Tempo/Tempus | Android | opcional | opcional | opcional | terceiro smoke |

A validação manual nunca substitui testes de contrato/ownership, e os testes não autorizam marcar cliente real como validado sem execução real.
