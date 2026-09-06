# Fase 7.5 — Ownership de favoritos por usuário

Este documento registra a migration de favoritos da Fase 7.5. O objetivo é transformar o antigo conjunto global de favoritos em dados pessoais associados a uma identidade persistida, sem perder os favoritos existentes no upgrade.

## Objetivo

Cada favorito passa a pertencer a exatamente um usuário.

A API pública para o frontend continua simples:

```text
GET /api/favorites
PUT /api/favorites/:id
```

O cliente não envia `userId`. O dono é sempre derivado de `request.user.id`, resolvido pelo backend a partir da sessão autenticada.

## Schema v7

A tabela ativa passa a ser conceitualmente:

```text
favorites
- user_id    NOT NULL -> users.id
- track_id   NOT NULL -> tracks.id
- created_at NOT NULL
- PRIMARY KEY (user_id, track_id)
```

Consequências:

- uma mesma faixa pode ser favorita de usuários diferentes;
- o mesmo usuário não pode duplicar a mesma faixa;
- remover um usuário remove seus favoritos por foreign key;
- remover uma faixa remove os favoritos relacionados por foreign key;
- não existe favorito ativo sem dono.

As consultas de domínio sempre incluem o usuário:

```sql
SELECT track_id
FROM favorites
WHERE user_id = ?;
```

A remoção também aplica ownership na própria query:

```sql
DELETE FROM favorites
WHERE user_id = ? AND track_id = ?;
```

Isso evita depender de filtro posterior em memória para separar dados pessoais.

## Preservação dos favoritos existentes

Antes desta migration, `favorites` era global e possuía apenas `track_id` e `created_at`.

No upgrade v6 → v7, a migration é executada em `BEGIN IMMEDIATE` e recria a tabela ativa com `user_id NOT NULL`.

### Banco que já possui usuários

Se a tabela `users` já possui contas, os favoritos legados são atribuídos à primeira conta criada, ordenada por `created_at` e com `id` como desempate determinístico.

A escolha é deliberadamente baseada na identidade original e não na role vigente. O primeiro administrador pode ter sido rebaixado ou desativado depois; isso não deve transferir silenciosamente seus dados pessoais para outro administrador.

O `created_at` original de cada favorito é preservado.

### Banco ainda pré-bootstrap

Existe uma janela de upgrade em que o schema precisa migrar antes de o primeiro administrador ser criado pelo preload de bootstrap.

Para não enfraquecer `favorites.user_id` tornando-o nullable, os registros antigos aguardam temporariamente em:

```text
legacy_favorites_pending
- track_id
- created_at
```

Essa tabela é somente staging de migration e não participa das rotas normais nem das queries de favoritos.

Na mesma transação que cria o primeiro administrador, o bootstrap:

1. insere o usuário;
2. copia os registros de `legacy_favorites_pending` para `favorites` usando o novo `userId`;
3. limpa o staging;
4. confirma a transação.

Assim não existe estado persistido parcialmente criado em que a conta foi bootstrapada mas seus favoritos antigos ficaram globais.

O bootstrap também possui recuperação defensiva: se encontrar usuários já existentes e staging pendente, atribui os registros à primeira conta criada antes de continuar.

## Fronteira das rotas

`GET /api/favorites` e `PUT /api/favorites/:id` usam exclusivamente `request.user.id`.

Uma sessão legada transitória sem identidade persistida (`request.user = null`) não recebe acesso a um conjunto global. A operação falha fechado até que exista uma identidade associada.

O body de `PUT /api/favorites/:id` continua contendo apenas:

```json
{
  "favorite": true
}
```

Não existe campo de usuário controlado pelo cliente.

## Compatibilidade do frontend

O contrato visual não muda.

`GET /api/favorites` continua respondendo:

```json
{
  "trackIds": ["..."]
}
```

A diferença é exclusivamente semântica: a lista agora corresponde à identidade autenticada atual.

Nenhuma alteração de React é necessária nesta atividade.

## Segurança e invariantes

- `favorites.user_id` é `NOT NULL` desde o schema v7;
- o backend nunca aceita `userId` vindo do payload ou da URL para favoritos próprios;
- leitura, inserção e remoção são sempre escopadas pelo usuário no SQL;
- foreign keys permanecem habilitadas no `HomeMusicDatabase`;
- IDs de usuário vazios ou fora do limite defensivo são recusados pelo serviço;
- inserir favorito para usuário inexistente falha pela foreign key;
- staging legado nunca é consultado pelas rotas normais;
- migration e claim do bootstrap são transacionais.

## Testes de regressão

A cobertura desta etapa inclui:

- dois usuários favoritando a mesma faixa sem conflito;
- remoção por um usuário sem afetar o outro;
- rejeição de `userId` inválido e de usuário inexistente;
- `user_id NOT NULL` no schema ativo;
- migration v6 com usuários existentes;
- atribuição ao primeiro usuário criado mesmo se sua role atual não for `admin`;
- preservação do timestamp original;
- migration v6 ainda sem usuários, usando staging fora da tabela ativa;
- claim do staging na criação do primeiro admin;
- recuperação defensiva de staging pendente quando a conta já existe;
- smoke de produção verificando schema v7 e acesso autenticado a favoritos.

## Escopo posterior

Esta atividade isola somente favoritos.

Histórico/estatísticas, playlists manuais, `playback_state` e downloads offline continuam com suas migrations próprias nas próximas atividades da Fase 7.5. O login normal de usuários secundários permanece deliberadamente limitado até que esses demais dados pessoais também estejam isolados.
