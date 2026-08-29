# Destino seguro de importações

A Fase 9 promove mídia para a biblioteca somente depois de validação técnica, revisão de metadata e verificação de duplicatas.

## Política de destino

- Pasta padrão: `Importados`.
- O administrador pode informar uma pasta relativa dentro de `MUSIC_DIR`.
- O nome do arquivo é previsível: `Artista - Título.ext` quando há artista, ou `Título.ext` quando não há.
- A extensão vem exclusivamente da decisão técnica da validação de mídia.
- Metadata usada no nome passa por normalização NFKC e sanitização de caracteres de controle, separadores e caracteres problemáticos em filesystems comuns.
- Componentes vazios, `.`/`..`, caminhos absolutos, backslash, nomes ocultos e nomes reservados do Windows são recusados.

## Colisões

A promoção nunca sobrescreve um arquivo existente. O primeiro nome livre é escolhido de forma determinística:

1. `Artista - Título.ext`
2. `Artista - Título (2).ext`
3. `Artista - Título (3).ext`
4. ... até o limite defensivo do planejador.

Promoções dentro do processo são serializadas durante a escolha do nome e a movimentação, evitando que dois jobs concorrentes escolham o mesmo destino.

## Confinamento e symlinks

- A raiz real de `MUSIC_DIR` é resolvida antes da operação.
- Pastas existentes são verificadas com `lstat` e não podem ser symlinks.
- Cada caminho resolvido é confirmado como descendente de `MUSIC_DIR`.
- Pastas novas são criadas componente a componente com permissão `0750`.
- Se a promoção falhar, pastas criadas e ainda vazias são removidas em ordem reversa.
- O primitive de staging faz a promoção com `link()` sem replace, recusa `EXDEV` e confirma que origem e destino representam o mesmo inode antes de remover o payload do staging.

## Gate de duplicatas

A promoção depende do resultado da Fase 9 de duplicatas:

- `exact` / `blocked`: promoção proibida;
- `probable` / `review`: promoção só depois de revisão explícita;
- `possible` / `notice`: pode seguir;
- `none` / `clear`: pode seguir.

O servidor valida o gate novamente na hora da promoção. A UI não é uma fonte de autorização.

## API administrativa

### `GET /api/admin/imports/:id/destination`

Calcula o destino previsto sem criar pastas ou mover arquivos. Aceita `folderPath` como query string opcional.

### `POST /api/admin/imports/:id/promote`

Promove o payload validado para a biblioteca. Aceita `{ "folderPath": "Importados" }`. Exige autenticação administrativa e o header de mutação `X-Home-Music-Request`.

A resposta contém o job atualizado e o destino realmente utilizado.

## Limite desta entrega

A #100 conclui a promoção física segura para `MUSIC_DIR`. A indexação incremental do arquivo recém-promovido em SQLite/memória e invalidação de caches pertence à #103.
