# Fase 7.5 — Ownership do estado do player

## Objetivo

Migrar o `playback_state` de uma única linha global para uma linha por usuário autenticado, preservando o estado atual durante o upgrade e impedindo que uma conta leia ou sobrescreva a sessão de reprodução de outra.

O contrato público de `GET /api/player/state` e `PUT /api/player/state` permanece o mesmo. A identidade é derivada exclusivamente da sessão autenticada no backend.

## Schema v10

O SQLite passa para a versão 10. A tabela ativa usa `user_id` como chave primária:

```sql
CREATE TABLE playback_state (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_track_id TEXT,
  position REAL NOT NULL DEFAULT 0,
  volume REAL NOT NULL DEFAULT 1,
  shuffle INTEGER NOT NULL DEFAULT 0,
  repeat_mode TEXT NOT NULL DEFAULT 'off',
  was_playing INTEGER NOT NULL DEFAULT 0,
  base_queue_json TEXT NOT NULL DEFAULT '[]',
  queue_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
```

Cada usuário pode ter no máximo uma linha. A remoção da conta elimina seu estado via `ON DELETE CASCADE`.

`current_track_id` e os IDs das filas continuam sem foreign key para `tracks`, mantendo o comportamento anterior: um rescan ou remoção de arquivo não torna a gravação do estado inválida. A camada da aplicação continua filtrando IDs válidos ao salvar pelas rotas HTTP.

## Migration do estado global

A migration v9 → v10 é transacional.

Quando já existe pelo menos uma conta, a linha global `id = 1` é atribuída deterministicamente à primeira conta criada, usando:

```sql
ORDER BY created_at ASC, id ASC
```

A role atual não participa da escolha. Isso preserva o ownership da conta original mesmo que ela tenha sido rebaixada posteriormente.

São preservados:

- faixa atual;
- posição;
- volume;
- shuffle;
- repeat;
- flag `wasPlaying`;
- fila base;
- fila efetiva;
- `updated_at` original.

## Upgrade antes do bootstrap

Se ainda não existir usuário quando a migration rodar, o estado global não permanece na tabela ativa sem dono. Ele é movido para `legacy_playback_state_pending`.

O primeiro bootstrap de administrador reivindica esse estado dentro da mesma transação que cria o usuário.

A recuperação também é executada quando o bootstrap encontra uma instalação já inicializada com staging pendente. Nesse caso, um estado ativo existente tem precedência: o claim usa `ON CONFLICT(user_id) DO NOTHING`, evitando que um snapshot legado mais antigo sobrescreva uma sessão já atualizada.

Após o claim, o staging é limpo.

## Isolamento da API

As rotas do player exigem identidade persistida:

- `GET /api/player/state` lê somente `request.user.id`;
- `PUT /api/player/state` grava somente `request.user.id`;
- nenhum `userId` é aceito por query, path ou body;
- ausência de identidade persistida falha fechado;
- respostas usam `Cache-Control: private, no-store`.

Um usuário sem estado salvo recebe o estado padrão e não herda a sessão de outra conta.

## Compatibilidade e robustez

A migration detecta se `playback_state` já possui `user_id`. Isso permite concluir com segurança um banco cujo schema v10 já foi aplicado, mas cujo `PRAGMA user_version` ficou atrasado.

O frontend não precisa alterar o formato das requisições ou respostas nesta etapa.

## Testes

As regressões cobrem:

- estados independentes para duas contas;
- estado padrão quando uma conta ainda não possui linha;
- rejeição de `userId` inválido e FK para usuário inexistente na gravação;
- migration v9 → v10 para a primeira conta criada;
- preservação de todos os campos e timestamps;
- staging pré-bootstrap e claim atômico;
- recuperação de staging com usuário já existente sem sobrescrever estado ativo;
- `user_version` atrasado com schema owner-aware já aplicado;
- smoke de produção com GET/PUT autenticado e acesso após mudança temporária de role.
