# AGENTS.md — backend (`apps/server`)

Estas regras complementam o `AGENTS.md` da raiz para mudanças em `apps/server`.

## Arquitetura do processo

Para mudanças de composição, leia `docs/server-composition.md`.

A separação atual é pragmática:

```text
index.ts
  -> wiring/lifecycle
routes
  -> tradução HTTP + autorização aplicável
services
  -> regras/orquestração
stores/managers/infrastructure
  -> SQLite / filesystem / mídia / processo externo
```

Preserve estas fronteiras:

- `index.ts` é composition root; não deve voltar a concentrar regra de domínio ou handlers de protocolo;
- `auth-policy.ts` é a política central e fail-closed da API da aplicação (`/api/*`); não instale RBAC paralelo para essas rotas;
- `LibraryService` é dono do snapshot/revision da biblioteca em memória;
- `PersonalLibraryService` concentra regras de dados pessoais extraídas dos handlers;
- `AdminTrackMutationService` coordena operações físicas administrativas sem substituir as garantias dos stores de filesystem;
- `AdminImportService` é o orquestrador único do pipeline de importação; não crie segundo owner de jobs/staging/promoção;
- `ServerInfrastructure` e `TrackMediaInfrastructure` compartilham recursos de processo; não duplique SQLite, cache, fila ou mídia para facilitar uma rota.

Mova lógica para a camada que realmente possui a regra, não apenas para reduzir o tamanho de um arquivo.

## Autenticação e autorização

O servidor é a fronteira real de segurança.

Para a API da aplicação (`/api/*`):

- classificação `public` / `authenticated` / `admin` continua central;
- `/api/admin/*` exige `admin`;
- ownership de favoritos, playlists, histórico, player e demais dados pessoais deriva da identidade autenticada;
- não aceite `userId` do cliente como autoridade para acessar recurso pessoal;
- mutações autenticadas preservam a proteção anti-CSRF da aplicação;
- mudança sensível de conta/sessão preserva revogação e proteção contra auto-lockout/remoção do último admin.

Se existir ou for criado protocolo HTTP fora da API da aplicação, ele precisa de **fronteira de autenticação explícita e fail-closed própria**. Não herde cookie web, anti-CSRF, role ou credencial de outro protocolo por acidente; compartilhe apenas as autoridades de domínio que forem realmente comuns.

Em qualquer superfície:

- mensagens externas são sanitizadas e não revelam existência de recurso de outro usuário quando a política vigente evita enumeração;
- senha, hash completo, cookie, token, API key/segredo e headers sensíveis não entram em logs;
- nova credencial deve ter lifecycle/revogação/ownership explícitos e armazenamento compatível com sua sensibilidade.

Ao criar nova superfície HTTP, confira a fronteira de autenticação correspondente e adicione teste negativo de acesso quando o risco justificar.

## SQLite e persistência

- preserve migrations ordenadas e compatíveis via `PRAGMA user_version`;
- não apague/recrie dados existentes apenas para simplificar migration;
- use transação para mudanças relacionadas e rollback integral em falha;
- mantenha foreign keys e regras de lifecycle existentes;
- considere WAL, locks, concorrência e reopen/restore quando a mudança tocar persistência;
- índice/snapshot só é publicado em memória depois da persistência correspondente ter sucesso;
- mudanças de schema/dados avaliam impacto de backup/restore e documentação de produção.

Stores pessoais e administrativos não devem ganhar acesso cruzado por conveniência. Preserve ownership e isolamento entre usuários.

## Biblioteca, scanner e concorrência

`MUSIC_DIR` é a fonte física da biblioteca; `LibraryService` mantém a projeção canônica em memória.

- scan incremental preserva a semântica `added / updated / removed` e não deve publicar estado parcialmente persistido;
- subpastas temporariamente indisponíveis/quarentena não devem virar remoção destrutiva acidental;
- operações que competem com scan/importação usam os locks/mutexes existentes;
- shutdown não fecha SQLite enquanto trabalho conhecido que depende dele ainda está ativo;
- integridade administrativa permanece diagnóstico read-only; não reutilize scan reconciliador quando isso puder remover registros;
- caches e índices derivados são recriáveis e não viram autoridade sobre a biblioteca.

## Filesystem e operações destrutivas

Qualquer operação física deve considerar:

- path traversal e paths absolutos inesperados;
- symlink escape;
- arquivo não regular;
- TOCTOU entre validação e uso;
- no-clobber/colisão;
- lock compartilhado com operações concorrentes;
- rollback/compensação em falha parcial;
- origem e destino confinados aos diretórios explicitamente permitidos.

Não aceite path físico do frontend como autoridade. Prefira identificador lógico e resolução server-side.

Quarentena/restauração é o caminho destrutivo preferencial quando disponível. Exclusão permanente permanece explícita e fortemente confirmada.

## Importação, URL e providers

Pipeline canônico:

```text
origem
-> staging/scratch fora de MUSIC_DIR
-> validação técnica
-> metadata
-> duplicatas
-> destino seguro / no-clobber
-> promoção
-> indexação incremental
```

Todas as origens devem convergir para esse pipeline; não crie pipeline paralelo para provider novo.

Para URL/egress, preserve conforme o caminho existente:

- protocolos permitidos;
- resolução DNS/IP e bloqueio de redes privadas/reservadas;
- validação a cada redirect;
- timeout;
- limite de bytes;
- Content-Type/arquivo esperado;
- cleanup de scratch/staging.

Saída de provider/processo externo é input não confiável. Provider não escreve diretamente em `MUSIC_DIR`.

Processos externos usam executável + argumentos com `shell: false`, timeout, limites de saída e cleanup da árvore quando aplicável. Não transforme parâmetro do usuário em shell livre.

Retry recomeça a etapa com estado consistente; não reutilize staging quebrado apenas porque o job anterior existe.

## Streaming, mídia e cache

- streaming revalida confinement/arquivo regular antes de servir bytes;
- HTTP Range e headers existentes fazem parte do contrato e não devem regredir silenciosamente;
- transcoding/cache são derivados e recriáveis; não alteram o arquivo original;
- ReplayGain/ganho efetivo é resolvido pelo servidor, não aceito como autoridade arbitrária do cliente;
- limites de concorrência/backpressure não devem ser contornados por nova rota ou provider;
- FFmpeg/FFprobe e artefatos externos são tratados como dependências falíveis, com erro/timeout/cleanup explícitos.

## Produção e frontend compilado

Em produção, o mesmo Fastify serve API, frontend compilado, capas e streaming. Mudanças em serving/readiness/lifecycle precisam considerar:

- `/health`, `/ready` e `/api/health` com seus níveis atuais de detalhe/autorização;
- assets hashados/cacheáveis versus HTML/shell `no-store`;
- `/api/*` sem fallback SPA;
- startup/shutdown coordenados;
- operação systemd documentada.

Não execute deploy/restart/restore real para validar alteração de servidor sem solicitação operacional explícita do usuário.

## Testes

Testes de servidor ficam próximos ao código e devem proteger regra/material de risco.

Comandos focados usuais:

```bash
npm run test -w @home-music/server
npm run typecheck -w @home-music/server
npm run test:security
```

O gate raiz continua sendo `npm run check`.

Escolha checks adicionais pelo risco:

- auth/admin/importação sensível -> `test:security`;
- schema/backup/restore -> smoke correspondente;
- performance/backpressure -> benchmark correspondente;
- scripts/systemd/Tailscale -> regras de `scripts/AGENTS.md`;
- fluxo que exige navegador real -> `e2e/AGENTS.md`.

Testes não dependem de biblioteca real, SQLite real, segredo real ou internet pública não determinística. Use diretórios temporários, fixtures, servidores locais e doubles controlados.
