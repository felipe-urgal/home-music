# Movimentação física segura de músicas

A issue #88 adiciona organização física de músicas pela Administração sem permitir operações fora de `MUSIC_DIR`.

## Objetivo

Permitir mover uma faixa para outra pasta e/ou renomear seu arquivo sem perder identidade, favoritos, histórico, playlists, overrides de metadados/capa ou disponibilidade.

A operação é administrativa e não é uma simples alteração de string no SQLite: filesystem, banco e índice em memória precisam terminar coerentes ou a operação deve ser compensada.

## Fluxo

Em **Administração → Gerenciar músicas → Organizar**, o administrador vê apenas o caminho relativo dentro da biblioteca e informa:

- pasta relativa de destino;
- nome do arquivo;
- a extensão atual deve ser preservada.

O caminho absoluto de `MUSIC_DIR` não é exposto ao frontend.

## API

### `GET /api/admin/tracks/:id/location`

Retorna somente informações relativas:

```json
{
  "trackId": "...",
  "relativePath": "Artista/Álbum/faixa.mp3",
  "folderPath": "Artista/Álbum",
  "fileName": "faixa.mp3"
}
```

### `POST /api/admin/tracks/:id/move`

Payload:

```json
{
  "folderPath": "Artista/Álbum",
  "fileName": "faixa.mp3"
}
```

A resposta mantém o mesmo `track.id`, devolve a localização final e informa se houve movimentação física real.

## Invariantes de segurança

- origem e destino precisam permanecer dentro do `realpath` de `MUSIC_DIR`;
- origem precisa ser arquivo regular e não symlink;
- cada componente existente da pasta de destino é validado com `lstat` + `realpath`;
- componentes `.`/`..`, caminhos absolutos, barra invertida, NUL e componentes ocultos são rejeitados;
- `.home-music-trash` nunca pode ser destino;
- o destino não pode sobrescrever arquivo existente;
- a extensão do áudio não pode ser trocada por esta operação;
- `EXDEV` é bloqueado: não há fallback para copy/delete porque isso perderia atomicidade;
- scan, quarentena e movimentação compartilham o mesmo lock de filesystem.

## Identidade da faixa

Historicamente o scanner deriva o ID inicial do caminho relativo. Uma movimentação administrativa, porém, mantém o ID existente e atualiza o caminho associado à faixa.

O scanner também reaproveita explicitamente o ID de uma faixa conhecida quando o arquivo naquele novo caminho precisa ser reprocessado por alteração de tamanho/mtime. Assim um rescan posterior não recria a faixa com outro ID.

Isso preserva as FKs e referências existentes de:

- favoritos;
- histórico;
- playlists;
- disponibilidade;
- overrides de metadados;
- overrides de capa.

## Letras sidecar

Como letras locais são descobertas pelo caminho do áudio, a movimentação acompanha automaticamente arquivos regulares existentes nos formatos usados pelo Home Music:

- `<stem>.lrc`;
- `<audio.ext>.lrc`;
- `<stem>.txt`.

Todas as colisões de áudio e sidecars são verificadas antes do primeiro `rename`. Se qualquer etapa posterior falhar, os arquivos já movidos são restaurados em ordem inversa.

## Consistência e rollback

Ordem da operação:

1. validar origem, payload e árvore de destino;
2. criar somente as pastas necessárias e seguras;
3. verificar colisões do áudio e sidecars;
4. executar `rename` do conjunto;
5. revalidar os destinos via `realpath`/arquivo regular;
6. atualizar `tracks.file_path`, `folder` e `folder_path` em transação SQLite;
7. atualizar `tracks`/`tracksById` em memória;
8. incrementar a revisão efetiva da biblioteca.

Falha antes do passo 4 não altera arquivos. Falha entre filesystem/SQLite/índice dispara compensação para o estado anterior. Se a própria compensação falhar, a API retorna erro operacional explícito em vez de declarar sucesso parcial.

## Cache e runtime

A atualização do índice em memória é imediata. Portanto, após o `200`:

- streaming usa o novo caminho sem restart;
- letras usam o novo caminho;
- capa física usa o novo caminho;
- cache de capa em memória é limpo;
- `/api/library` mantém o mesmo ID e passa a refletir a nova pasta;
- polling entre abas percebe a alteração pela revisão composta.

## Fora do escopo

- mover em lote várias faixas nesta primeira UI;
- alterar extensão/formato;
- copiar entre filesystems;
- reescrever tags do áudio;
- organizar automaticamente por regras de metadata.

O serviço foi desenhado para poder ser reutilizado posteriormente por ações em lote, mantendo as mesmas invariantes por faixa.

## Testes

A entrega cobre:

- traversal, caminho absoluto, hidden path e troca de extensão;
- symlink escape;
- colisão de destino;
- movimentação com criação de pasta;
- sidecars de letras;
- preservação do `track.id`;
- rollback de filesystem e SQLite quando o índice falha;
- integração das rotas administrativas e revisão da biblioteca;
- rescan após movimentação sem troca de ID;
- Playwright desktop com movimentação, streaming, rescan e restauração da fixture.
