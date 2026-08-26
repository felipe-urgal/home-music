# Fase 7.5 — Auditoria de IDOR e ownership por ID

Esta atividade revisa as superfícies da API e do SQLite que recebem ou derivam identificadores, com foco em impedir acesso cruzado entre usuários autenticados.

## Objetivo

A regra de segurança da Fase 7.5 é:

- dados pessoais são resolvidos no escopo do usuário autenticado;
- quando o recurso pessoal pertence a outra conta, a aplicação se comporta como se ele não existisse para o usuário atual;
- a biblioteca física e playlists Rekordbox continuam compartilhadas por decisão arquitetural;
- IDs imprevisíveis não são considerados um controle de autorização;
- `userId` de operações pessoais nunca é confiado a body, query string ou parâmetro enviado pelo cliente.

## Resultado da revisão

A revisão não encontrou uma rota pessoal que permitisse efetivamente acessar dados de outra conta na `main` após o PR #53. Favoritos, histórico/estatísticas, playlists manuais e playback state já recebiam `request.user.id` e aplicavam o usuário nas queries principais.

Foi encontrado, porém, um ponto de hardening nas queries filhas de playlists: depois de uma playlist já ter sido filtrada ou validada pelo proprietário, alguns acessos a `playlist_tracks` ainda usavam apenas `playlist_id`. O fluxo atual era síncrono e a checagem anterior já impedia exploração prática, mas o padrão deixava a autorização dependente de uma etapa anterior.

Esta atividade remove essa dependência como única barreira: leitura, remoção e inserção de faixas passam a carregar também o escopo do pai na própria instrução SQL.

## Matriz auditada

| Superfície | Tipo de ID | Escopo esperado | Resultado |
| --- | --- | --- | --- |
| `favorites` | `track_id` | `user_id + track_id` | protegido no SQL |
| `history` | `track_id` / registros históricos | `user_id` | protegido no SQL |
| estatísticas | agregações de histórico | `user_id` | protegido no SQL |
| playlists manuais | `playlist.id` | `source = 'manual' + owner_user_id` | protegido no SQL |
| faixas de playlist manual | `playlist_id` | ownership herdado da playlist no mesmo SQL | endurecido nesta atividade |
| playback state | `user_id` | linha por usuário | protegido no SQL |
| sessão / identidade | `userId` da sessão | identidade resolvida no servidor | protegido |
| gestão administrativa de usuários | `targetUserId` | acesso cruzado intencional, somente admin | protegido pela política admin + serviço |
| faixas da biblioteca | `track.id` | compartilhado | não recebe ownership por usuário |
| playlists Rekordbox | `playlist.id` | compartilhado e somente leitura nas rotas pessoais | comportamento intencional |

## Mudanças aplicadas

### `getPlaylists`

A leitura de `playlist_tracks` agora faz `JOIN playlists` e repete a regra de visibilidade:

- Rekordbox: compartilhado;
- manual: somente `owner_user_id = currentUser.id`.

Assim, o acesso às faixas não depende apenas de a lista de playlists ter sido filtrada antes.

### `setPlaylistTracks`

A mutação deixou de fazer uma checagem de existência/ownership e depois executar `DELETE`/`INSERT` somente por `playlist_id`.

Agora:

- o `UPDATE` que abre a mutação exige `id + source='manual' + owner_user_id`;
- o `DELETE` de faixas contém um `EXISTS` com a mesma regra de ownership;
- cada `INSERT` usa `INSERT ... SELECT` a partir da playlist que pertence ao usuário;
- toda a operação continua em `BEGIN IMMEDIATE`, com rollback em falha;
- tentativa de usar o UUID de outra conta retorna `false` na camada de banco e continua resultando em `404` na rota.

### Sincronização Rekordbox

A sincronização administrativa também foi tornada explícita sobre o domínio compartilhado:

- somente `source = 'rekordbox'`;
- `owner_user_id IS NULL`;
- remoção e inserção de `playlist_tracks` repetem esse escopo no SQL.

Isso evita que uma futura regressão ou inconsistência de ID transforme uma operação administrativa de Rekordbox em mutação de playlist manual.

## IDs compartilhados que não devem receber ownership

Nem todo `/:id` representa um recurso pessoal.

Os IDs de faixa usados por streaming, capa, letras, favoritos e histórico apontam para a biblioteca compartilhada. O ownership é aplicado ao relacionamento pessoal (`favorites`, `history`), não ao registro global de `tracks`.

Da mesma forma, playlists Rekordbox são parte da biblioteca compartilhada. Usuários autenticados podem lê-las, mas as operações manuais de rename/delete/alteração de faixas recusam esse `source`; a reimportação continua administrativa.

## IDs administrativos

`AdminUsersService` aceita um `targetUserId` porque administrar outra conta é a própria finalidade da API. Isso não é IDOR quando:

- a rota está sob a política `admin`;
- o ator é revalidado como administrador ativo dentro do serviço;
- auto-lockout e último administrador continuam protegidos;
- operações que alteram conta revogam as sessões necessárias.

Portanto, não se adiciona `actorUserId = targetUserId` às queries administrativas: isso quebraria a funcionalidade legítima.

## Regressões adicionadas

`apps/server/src/idor-ownership-audit.test.ts` cobre dois usuários usando IDs conhecidos e verifica:

- favoritos independentes;
- histórico e estatísticas independentes;
- playback state independente;
- playlist manual de B invisível e imutável por A mesmo conhecendo o UUID;
- tentativa cruzada não altera as faixas do proprietário real;
- playlist manual própria continua editável;
- Rekordbox continua visível para ambos;
- Rekordbox continua imutável pelas mutações manuais;
- sincronização administrativa Rekordbox continua funcionando.

## Review sênior — critérios

A revisão desta atividade deve confirmar:

1. nenhuma API pessoal aceita `userId` do cliente como identidade;
2. todo dado pessoal usa `request.user.id` como origem de identidade;
3. queries por ID de recursos pessoais incluem ownership no SQL quando aplicável;
4. recursos compartilhados não receberam isolamento indevido;
5. `404` continua sendo a resposta para playlist pessoal inexistente ou de outra conta;
6. operações admin com `targetUserId` permanecem possíveis somente sob autorização administrativa;
7. não houve mudança de schema, migration ou contrato JSON;
8. a branch contém somente hardening, regressões e documentação desta atividade.

## Validação local obrigatória antes do merge

Executar com Node 22, na raiz do repositório:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:production
npm run e2e:ci
```

O merge só deve acontecer após esses gates passarem localmente e após autorização explícita do mantenedor.
