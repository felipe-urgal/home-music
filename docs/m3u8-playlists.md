# Playlists M3U8

O Home Music usa M3U8 apenas como formato portátil de **referências de playlist**. Importar uma playlist não baixa, copia, move ou indexa áudio e não cria uma segunda biblioteca.

## Modelo de segurança

Todo arquivo/conteúdo M3U8 é entrada externa não confiável.

A resolução aceita somente caminhos relativos que existam no snapshot canônico atual da biblioteca (`MUSIC_DIR` já indexado) **e estejam disponíveis para uso**. Faixas administrativamente desabilitadas não são anunciadas como resolvidas, porque o modelo canônico de playlists também não permitiria adicioná-las.

O servidor não faz requests de rede, não segue `file://`, não interpreta URLs e não acessa caminhos absolutos do host.

São rejeitados ou classificados como inválidos:

- `..` e traversal de diretório;
- paths absolutos POSIX;
- paths absolutos/drive/UNC do Windows;
- URLs e qualquer URI com scheme;
- NUL e paths vazios;
- linhas acima do limite defensivo.

Metadata `#EXT*` e comentários são ignorados para matching. Não existe fuzzy matching por título/artista e uma referência ambígua nunca escolhe uma faixa silenciosamente.

## Limites defensivos

O contrato corrente usa:

- request/conteúdo: até 256 KiB;
- até 10.000 linhas físicas;
- até 5.000 entradas de playlist;
- até 4.096 caracteres por linha de entrada.

O limite de 256 KiB também coincide com o `bodyLimit` global do servidor.

## Preview

```http
POST /api/playlists/m3u8/preview
Content-Type: application/json

{
  "content": "#EXTM3U\nArtista/Album/faixa.flac\n"
}
```

O preview é read-only e classifica cada entrada como:

- `resolved` — path relativo corresponde exatamente a uma faixa atual e disponível;
- `not-found` — path seguro, mas ausente ou indisponível na biblioteca atual;
- `invalid` — entrada não suportada ou insegura;
- `ambiguous` — mais de uma faixa disponível teria o mesmo path portátil; nenhuma é escolhida.

A resposta inclui `previewHash`, SHA-256 do conteúdo exato recebido. Esse hash vincula a confirmação ao mesmo conteúdo que foi revisado.

## Confirmação e criação

```http
POST /api/playlists/m3u8/import
Content-Type: application/json

{
  "name": "Minha playlist",
  "content": "#EXTM3U\nArtista/Album/faixa.flac\n",
  "previewHash": "...",
  "confirmed": true
}
```

A criação só ocorre quando:

1. há sessão autenticada persistida;
2. `confirmed` é exatamente `true`;
3. `previewHash` corresponde ao conteúdo atual;
4. o servidor refaz parsing e resolução no momento da confirmação;
5. existe pelo menos uma faixa resolvida.

O servidor nunca confia em IDs de faixa enviados pelo cliente como resultado de preview. Entradas `not-found`, `invalid` ou `ambiguous` permanecem visíveis no resumo e só são ignoradas depois da confirmação explícita.

A playlist criada é manual e pertence sempre a `request.user.id`; `userId` recebido do cliente não concede ownership.

Se a playlist for criada mas a gravação das faixas falhar, a criação é revertida para não deixar objeto vazio parcial.

### Ordem e duplicatas

A ordem das faixas resolvidas é preservada. O modelo canônico de playlists manuais já deduplica IDs e limita a 5.000 faixas; portanto ocorrências repetidas da mesma faixa colapsam para a primeira ocorrência. O importador reutiliza esse contrato em vez de criar uma persistência paralela.

## Exportação

```http
GET /api/playlists/:id/m3u8
```

Somente playlists **manuais da conta autenticada** podem ser exportadas. Playlists Rekordbox compartilhadas continuam read-only e não usam esta superfície.

A saída começa com `#EXTM3U` e contém apenas paths relativos POSIX à raiz canônica da biblioteca, mantendo a ordem da playlist.

Paths absolutos nunca são publicados. Se qualquer faixa da playlist estiver desabilitada, não puder ser convertida com segurança para um path portátil ou tiver um nome que não faça round-trip determinístico no formato (por exemplo, começando com `#`, whitespace nas bordas ou separador incompatível), a exportação falha fechada em vez de omitir ou reinterpretar a faixa silenciosamente.

## Invariantes

A interoperabilidade M3U8:

- não altera `MUSIC_DIR`;
- não baixa mídia;
- não dispara scanner;
- não acessa rede;
- não cria segunda biblioteca;
- não concede acesso cruzado entre contas;
- reutiliza `PersonalLibraryService` para criação/ownership e `LibraryService` como snapshot canônico de faixas.
