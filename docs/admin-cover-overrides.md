# Overrides administrativos de capa

Issue: #87

## Objetivo

Permitir adicionar ou substituir a capa exibida pelo Home Music sem escrever no arquivo de áudio por padrão. A operação é reversível, validada no backend e sobrevive a novos scans.

## Decisão de arquitetura

A capa física continua sendo a imagem embutida no arquivo de áudio, descoberta pelo scanner. Uma correção administrativa é armazenada separadamente no SQLite, em `track_cover_overrides`.

A resolução efetiva segue esta precedência:

1. override de capa no SQLite;
2. capa física embutida no arquivo;
3. fallback visual do frontend quando nenhuma das duas existe.

O fallback do item 3 é uma política visual central do frontend, não um terceiro tipo de capa persistida. A implementação e as regras de reutilização estão em [artwork-fallback.md](artwork-fallback.md).

O scanner não lê nem escreve `track_cover_overrides`. Um re-scan pode atualizar a informação física em `tracks.has_cover`, mas não promove, sobrescreve ou apaga um override enquanto a faixa continuar existindo.

## Persistência

`track_cover_overrides` contém uma linha por faixa:

- `track_id` com FK para `tracks(id)` e `ON DELETE CASCADE`;
- MIME efetivo validado;
- largura e altura;
- tamanho em bytes;
- SHA-256 do conteúdo;
- BLOB da imagem;
- timestamp da última atualização.

O arquivo de áudio nunca é modificado por essas rotas.

## Formatos e limites

Formatos aceitos:

- JPEG;
- PNG;
- WebP.

Limites do backend:

- até 8 MiB;
- largura e altura máximas de 4096 px;
- até aproximadamente 16 MP;
- assinatura binária precisa corresponder ao `Content-Type` informado;
- estrutura mínima do formato precisa ser reconhecível antes da persistência.

A validação do frontend existe apenas para feedback antecipado. O backend continua sendo a fronteira autoritativa.

## API administrativa

Todas as rotas abaixo permanecem sob a política administrativa existente.

### Consultar estado

`GET /api/admin/tracks/:id/cover`

Retorna:

- se o arquivo físico possui capa;
- se existe capa efetiva;
- detalhes do override quando presente (`contentType`, dimensões, tamanho, `updatedAt` e `version`).

Faixas na lixeira precisam ser restauradas antes de editar a capa.

### Criar ou substituir override

`PUT /api/admin/tracks/:id/cover`

O corpo é a imagem binária, usando `Content-Type: image/jpeg`, `image/png` ou `image/webp`.

O servidor valida os bytes e só então faz o `UPSERT` no SQLite. Uma falha de validação não substitui o override anterior.

### Restaurar fonte física

`DELETE /api/admin/tracks/:id/cover`

Remove somente o override. Se o arquivo tiver capa embutida, ela volta a ser exibida. Caso contrário, o frontend volta ao fallback visual.

## Entrega da capa efetiva

`GET /api/tracks/:id/cover` prioriza o BLOB de override quando a faixa está ativa. Sem override, o handler físico existente continua lendo a capa do arquivo de áudio.

O SHA-256 gera uma versão curta exposta em `Track.coverVersion`. O frontend inclui essa versão na URL (`?v=...`) para que uma substituição de capa não reutilize uma imagem antiga do cache do navegador.

Mudanças de capa também incrementam a revisão administrativa composta de `/api/library` e `/api/library/status`, permitindo que outras abas recarreguem a biblioteca pelo polling já existente.

## Administração atual

A edição de capa faz parte do workspace **Administração → Metadados**, junto da edição textual da mesma faixa. O redesign do PR #177 removeu o fluxo centrado em modal: no desktop a lista de músicas permanece à esquerda e o editor persistente fica à direita; em telas menores o editor assume a área principal.

Fluxo:

1. selecionar a faixa no workspace;
2. selecionar JPEG/PNG/WebP;
3. conferir o preview local antes de qualquer upload;
4. salvar a capa como override;
5. se necessário, usar `Restaurar capa do arquivo` para remover o override.

A UI deixa explícito quando a imagem selecionada ainda é somente um preview local e quando existe um override ativo. Trocar de faixa, fechar o editor ou sair da tela respeita a proteção de alterações não salvas do workspace.

Quando a faixa não possui override nem capa física, o quadrado de preview reutiliza `ArtworkFallback`, a mesma representação visual usada pela biblioteca e pelo player. Um arquivo selecionado localmente continua substituindo temporariamente esse fallback pelo preview real antes do upload.

## Segurança e rollback

- nenhuma rota desta entrega escreve tags ou imagem no arquivo de áudio;
- upload usa limite explícito de corpo e validação de conteúdo;
- MIME declarado sozinho não é confiado;
- faixa em quarentena não pode receber alteração de capa;
- faixa desativada não ganha acesso público à capa por causa do override;
- `ON DELETE CASCADE` evita BLOB órfão quando a faixa deixa definitivamente a biblioteca;
- falha de validação acontece antes da transação que substitui o BLOB;
- remover o override é o rollback normal da operação.

## Escrita opcional de volta ao arquivo

Não faz parte do comportamento atual. Se implementada no futuro, deverá ser uma ação explicitamente destrutiva/separada, com backup/rollback, validação do formato de áudio e confirmação própria. O comportamento padrão continuará não destrutivo.

## Testes

A cobertura inclui:

- inspeção de formato e dimensões;
- rejeição de MIME incompatível e arquivo inválido;
- persistência entre reinicializações;
- precedência do override sem alterar `tracks.has_cover`;
- rollback quando um novo upload é inválido;
- remoção por FK ao excluir a faixa;
- rotas administrativas de consultar/salvar/restaurar;
- resolução efetiva em `/api/library`;
- entrega binária pelo endpoint público;
- cache-busting por versão;
- validação antecipada no frontend;
- regressão do componente central de artwork/fallback no Vitest;
- Playwright desktop com preview → salvar → API efetiva → rescan → restauração.
