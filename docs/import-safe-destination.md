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
- A primitiva de staging faz a promoção sem replace, recusa `EXDEV` e confirma a identidade esperada antes de remover o payload temporário.

## Gate de duplicatas

A promoção depende do resultado da etapa de duplicatas:

- `exact` / `blocked`: promoção proibida;
- `probable` / `review`: promoção só depois de revisão explícita;
- `possible` / `notice`: pode seguir;
- `none` / `clear`: pode seguir.

O servidor valida o gate novamente na hora da promoção. A UI não é fonte de autorização.

## API administrativa

### `GET /api/admin/imports/:id/destination`

Calcula o destino previsto sem criar pastas ou mover arquivos. Aceita `folderPath` como query string opcional.

### `POST /api/admin/imports/:id/promote`

Promove o payload validado para a biblioteca. Aceita `{ "folderPath": "Importados" }`. Exige autenticação administrativa e o header de mutação `X-Home-Music-Request: 1`.

A resposta contém o job atualizado e o destino realmente utilizado.

## Depois da promoção

A promoção física não encerra o fluxo sozinha. O Home Music tenta incorporar o arquivo imediatamente ao índice da biblioteca usando a atualização incremental entregue na #103.

Fluxo:

```text
promover arquivo
  ↓
indexar somente o novo arquivo sob LibraryMutationLock
  ↓
persistir SQLite
  ↓
atualizar snapshot/revisão em memória
  ↓
job completed
```

Se a atualização incremental não puder ser aplicada com segurança, o servidor pode convergir por scan completo sob o mesmo lock. Se até essa reconciliação falhar, o arquivo promovido permanece em `MUSIC_DIR`, o snapshot anterior é preservado e o job não deve fingir conclusão bem-sucedida.

Detalhes: [import-incremental-library-update.md](import-incremental-library-update.md).

## UX atual

No workbench **Origem → Preparar → Revisar → Biblioteca**, o planejamento de pasta/nome aparece antes da ação final de promoção. A interface exibe destino relativo e resultado esperado sem expor o caminho absoluto da biblioteca.

## Testes

A cobertura relevante inclui:

- traversal/caminho absoluto/componentes inválidos;
- symlink escape;
- colisão sem overwrite;
- criação segura de pasta;
- gate de duplicatas;
- concorrência entre promoções;
- integração promoção → indexação incremental;
- falha de indexação sem duplicar a mídia nem declarar sucesso falso.
