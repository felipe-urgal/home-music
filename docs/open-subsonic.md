# OpenSubsonic

Esta página define o subset OpenSubsonic suportado pelo Home Music na Fase 13 e, principalmente, a fronteira arquitetural do adapter.

> Regra: **OpenSubsonic é somente um adapter de protocolo**. Biblioteca, usuários, favoritos, playlists, histórico, streaming e filesystem continuam tendo a mesma autoridade usada pelo frontend Home Music.

## Clientes-alvo

O subset inicial é guiado por clientes reais que já suportam servidores OpenSubsonic/Subsonic:

- **Symfonium** — alvo mobile principal;
- **Feishin** — alvo desktop principal;
- **Tempo/Tempus** — terceiro alvo de compatibilidade para smoke manual quando aplicável.

O CI não instala nem depende desses aplicativos. Compatibilidade automatizada usa cliente HTTP/fixtures locais e os clientes reais entram apenas na validação manual documentada.

O inventário atual mostrou duas formas de bootstrap relevantes:

- Symfonium oferece suporte explícito à extensão `apiKeyAuthentication`;
- Feishin usa `getUser` durante autenticação e, no modo **Legacy Authentication**, envia `u+p`. Para esse caso, o Home Music aceita **a mesma API key revogável como `p`**, nunca a senha web.

## Autenticação

O adapter **não reutiliza cookie, sessão ou senha web** como credencial genérica de cliente externo.

A credencial continua sendo sempre uma API key Home Music criada em **Minha conta**:

- o valor em claro é mostrado somente no momento da criação;
- o SQLite guarda somente SHA-256 da chave e um hint não sensível;
- cada chave pertence a um `userId` imutável;
- listar/revogar uma chave sempre deriva ownership da sessão web atual;
- chamadas `/rest/*` derivam ownership exclusivamente da chave autenticada;
- revogar a chave não revoga a sessão web;
- usuário desabilitado ou com troca obrigatória de senha deixa de autenticar pelo adapter.

Mecanismos aceitos:

1. **OpenSubsonic `apiKeyAuthentication`** — `apiKey=<chave>`, sem `u`;
2. **compatibilidade legada para clientes sem campo de API key** — `u=<username>&p=<chave>`, inclusive `p=enc:<hex>` quando o cliente usa o encoding legado.

No segundo caso, `p` é autenticado somente contra o hash das API keys dedicadas. Uma senha web correta não passa por esse caminho. O `u` precisa corresponder ao owner da chave. Token/salt `t+s` continua recusado porque verificar esse formato exigiria reintroduzir material de senha/chave em claro no servidor.

Para Feishin, a configuração esperada para o smoke manual é: username Home Music, **API key no campo password** e **Legacy Authentication habilitado**.

Como a chave OpenSubsonic é transportada em query parameter pelo protocolo, o logger HTTP do servidor remove a query string antes de registrar a URL de request, inclusive nos caminhos explícitos de erro/backpressure.

## Contrato HTTP de gerenciamento de chaves

Os payloads públicos usados por **Minha conta** para listar/criar API keys são definidos em `@home-music/shared/open-subsonic`. Server e web consomem o mesmo shape tipado, evitando DTOs paralelos que possam divergir silenciosamente entre as duas camadas.

O contrato compartilhado contém apenas dados públicos da credencial (`id`, nome, hint, data e token one-time somente na resposta de criação). `userId`, hash persistido, detalhes de SQLite e qualquer outro segredo interno não fazem parte dele.

TypeScript compartilhado não substitui validação de fronteira: o frontend continua validando a resposta HTTP em runtime e falha fechado se o payload recebido não corresponder ao contrato esperado.

## Matriz endpoint → autoridade Home Music

Esta matriz existe **antes dos handlers** para impedir a criação acidental de uma segunda fonte de verdade.

| Endpoint OpenSubsonic | Autoridade/serviço Home Music | Regra do adapter |
| --- | --- | --- |
| `ping` | composição do servidor | somente envelope/versionamento |
| `getOpenSubsonicExtensions` | contrato do adapter | público; anuncia apenas extensions realmente implementadas |
| `tokenInfo` | credenciais OpenSubsonic + usuário persistido | resolve a API key sem expor hash/token |
| `getUser` | credencial autenticada + usuário persistido | bootstrap de cliente; retorna somente o próprio usuário e papéis compatíveis com o subset |
| `getMusicFolders` | `LibraryService` | uma biblioteca lógica; nenhum path físico |
| `getIndexes` | `LibraryService.listPublicTracks()` | projeção de artistas sobre o snapshot atual |
| `getArtists` | `LibraryService.listPublicTracks()` | agregação somente em memória, sem segundo índice persistente |
| `getArtist` | `LibraryService.listPublicTracks()` | ID opaco derivado da projeção canônica |
| `getAlbumList2` | `LibraryService.listPublicTracks()` | apenas ordenações com semântica disponível no snapshot |
| `getAlbum` | `LibraryService.listPublicTracks()` | álbum projetado; faixas continuam sendo as mesmas tracks |
| `getSong` | `LibraryService.getTrack()` + projeção pública | nunca inclui `filePath`/path físico; `path` de protocolo é opaco e usa o ID da faixa |
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

## IDs e campos do protocolo

`track.id` do Home Music permanece o ID da música.

Artistas e álbuns recebem IDs opacos e determinísticos derivados da projeção canônica atual. Esses IDs existem somente no adapter e **não formam um segundo catálogo persistido**.

Campos exigidos pelo protocolo/clients, como `created`, `discNumber`, `artists`, `albumArtists` e `path`, são projetados sem transformar metadados externos em autoridade. Em especial, `path` usa um identificador opaco e nunca contém caminho físico do servidor.

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
- o modo `u+p` compatível autentica `p` como API key e nunca consulta/verifica a senha web;
- `username`, IDs de playlist e demais parâmetros do cliente nunca substituem a identidade autenticada;
- não existe superfície administrativa OpenSubsonic no subset inicial;
- erros públicos não incluem stack, path, query secreta, hash ou token;
- chamadas inválidas/credenciais inválidas possuem rate limit local e falham sem enumeração de usuários;
- o mapa interno do rate limiter tem cardinalidade máxima e falha fechado sob churn de subjects, evitando crescimento de memória sem limite;
- nenhuma resposta de biblioteca expõe `filePath`, `MUSIC_DIR` ou path absoluto;
- nenhuma mutação confia em validação do cliente;
- SQLite e scanner continuam únicos.

## Compatibilidade automatizada

A suíte do servidor cobre pelo menos:

1. capabilities públicas sem credencial;
2. chave válida, inválida e revogada;
3. `apiKeyAuthentication` nativa;
4. bootstrap `getUser` usando a API key como password legado sem aceitar senha web;
5. listagem de biblioteca e busca;
6. Range de streaming;
7. artwork/lyrics sem path físico;
8. playlist/favorito/scrobble derivados do owner autenticado;
9. tentativa cross-user/IDOR;
10. endpoint não suportado retornando falha explícita;
11. limite de cardinalidade do rate limiter;
12. ausência de rede pública no teste.

## Matriz de validação manual

Esta tabela deve ser preenchida com evidência real antes de fechar #264.

| Cliente | Plataforma | Autentica | Lista biblioteca | Reproduz áudio | Observações |
| --- | --- | --- | --- | --- | --- |
| Symfonium | Android | pendente | pendente | pendente | usar o campo próprio de API key |
| Feishin | desktop | pendente | pendente | pendente | username + API key como password + Legacy Authentication |
| Tempo/Tempus | Android | opcional | opcional | opcional | terceiro smoke |

A validação manual nunca substitui testes de contrato/ownership, e os testes não autorizam marcar cliente real como validado sem execução real.