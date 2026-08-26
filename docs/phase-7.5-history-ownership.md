# Fase 7.5 — Ownership de histórico e estatísticas

Esta etapa migra o histórico de reprodução global para dados pessoais associados a `user_id`. As estatísticas continuam sendo derivadas do histórico, mas passam a usar exclusivamente as linhas do usuário autenticado.

## Objetivos

- impedir que uma conta leia ou apague o histórico de outra;
- impedir que estatísticas agreguem reproduções de usuários diferentes;
- preservar o histórico existente na conta original durante o upgrade;
- manter o limite de histórico independente por usuário;
- manter o contrato atual do frontend para histórico e estatísticas.

## Schema v8

A tabela ativa `history` passa a exigir dono persistido:

```sql
CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  played_at TEXT NOT NULL
);

CREATE INDEX idx_history_user_played_at
ON history(user_id, played_at DESC, id DESC);
```

Não existe histórico ativo com `user_id = NULL`.

## Migração do histórico legado

A migration v7 → v8 é transacional.

### Quando o primeiro usuário já existe

O histórico legado é movido diretamente para a primeira conta criada, determinada por:

```sql
ORDER BY created_at ASC, id ASC
```

A escolha não depende da role atual da conta. Isso evita transferir dados pessoais caso o primeiro administrador tenha mudado de papel depois.

A migration preserva `played_at` e os IDs existentes quando faz a transferência direta.

### Quando a migration ocorre antes do primeiro bootstrap

As linhas antigas são armazenadas temporariamente em:

```sql
legacy_history_pending
```

Essa tabela não é consultada pelas rotas normais. A tabela ativa `history` permanece vazia e sempre exige `user_id`.

No bootstrap do primeiro administrador, o staging é reivindicado dentro da mesma transação que cria a conta. O bootstrap também possui recuperação defensiva para staging pendente quando um usuário já existe.

## Isolamento no domínio

As operações de banco agora exigem `userId` explícito:

- `recordHistory(userId, trackId, playedAt?)`;
- `getHistory(userId, limit?)`;
- `clearHistory(userId)`;
- `getStatistics(userId, period, now?)`.

O filtro de ownership é aplicado no próprio SQL. Não é feito carregamento global seguido de filtro em memória.

## Capacidade do histórico

O limite continua sendo 2.000 reproduções, mas agora é aplicado por usuário.

Ao gravar uma reprodução, somente linhas antigas daquele mesmo `user_id` podem ser removidas. Uma conta com uso intenso não reduz o histórico disponível de outra.

## Estatísticas

Os agregados usam sempre:

```sql
WHERE h.user_id = ?
```

Quando há período (`7d` ou `30d`), a condição temporal é adicionada ao mesmo filtro de ownership.

Isso vale para:

- total de reproduções;
- minutos reproduzidos;
- faixas únicas;
- artistas únicos;
- primeira reprodução;
- top faixas;
- top artistas;
- top álbuns.

## Rotas HTTP

As rotas continuam com o mesmo formato externo, mas o dono é derivado exclusivamente de `request.user.id`:

- `GET /api/history`;
- `POST /api/history/:id`;
- `DELETE /api/history`;
- `GET /api/statistics`.

Nenhuma rota aceita `userId` enviado pelo cliente.

Sessões sem identidade persistida falham fechado em vez de cair em histórico ou estatísticas globais.

## Compatibilidade

Não há mudança visual nesta atividade.

O frontend continua recebendo os mesmos formatos de histórico e estatísticas. A alteração é de persistência, autorização e isolamento.

Playlists manuais e `playback_state` continuam globais até as próximas migrations específicas da Fase 7.5.

## Regressões relevantes

Os testes desta etapa cobrem:

- histórico independente entre dois usuários;
- estatísticas independentes entre dois usuários;
- limpeza de histórico sem afetar outra conta;
- limite de 2.000 linhas por usuário;
- `user_id NOT NULL` e foreign key para usuários;
- migration v7 → v8 com usuários existentes;
- escolha determinística da primeira conta criada;
- preservação de timestamps e ordem do histórico legado;
- migration antes do bootstrap usando staging;
- claim do staging no primeiro bootstrap;
- recuperação de staging pendente com usuário já existente;
- smoke de produção com schema v8 e acesso autenticado a histórico/estatísticas.
