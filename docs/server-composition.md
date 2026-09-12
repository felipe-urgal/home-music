# Composição do servidor

Este documento descreve as fronteiras correntes do processo Fastify depois das refatorações da Fase 11 e das extensões posteriores, incluindo o controle remoto da TV.

## Objetivo

`apps/server/src/index.ts` é o **composition root** do backend. Ele pode:

- carregar configuração de ambiente;
- criar a instância Fastify;
- construir/conectar dependências;
- instalar políticas e registrar módulos de rota;
- coordenar startup, shutdown, auto-rescan e `listen`.

Ele não deve implementar regras de domínio, acesso direto à biblioteca, manipulação de mídia ou handlers HTTP de `/api/*`.

## Camadas

```text
index.ts
  ↓ wiring
routes / route composition
  ↓ contratos explícitos
services / managers
  ↓
infrastructure / stores
```

A separação é pragmática, sem framework de DI ou container global.

## Routes

Handlers Fastify ficam agrupados por domínio:

- `auth-routes.ts` — status/login/logout/troca de senha e sessões pessoais;
- `library-routes.ts` — snapshot/status/rescan, overview e integridade;
- `personal-routes.ts` — favoritos, playlists, player state, views, smart playlists e histórico;
- `media-routes.ts` — lyrics, capa, streaming e transcoding;
- `tv-remote-routes.ts` — sessão efêmera do controle TV, snapshot/comandos e SSE;
- `system-routes.ts` — liveness/readiness/diagnóstico e fallback do frontend;
- módulos administrativos separados por domínio (`admin-*-routes.ts`).

Rotas traduzem HTTP para serviços/managers: validam detalhes da API, escolhem status/headers e preservam mensagens externas. Regras de domínio e primitivas físicas permanecem fora dos handlers.

A composição da importação fica em `admin-import-service-routes.ts`; `admin-import-routes.ts` permanece como façade compatível.

## Services e managers

`library-service.ts` é dono do estado/ciclo de vida da biblioteca em memória: snapshot, disponibilidade, revisão, scan, locks, integridade e reconciliação após importação.

`personal-library-service.ts` concentra favoritos, playlists manuais e estado/fila pessoal do player.

`admin-track-mutation-service.ts` coordena movimentação física, quarentena, restauração e exclusão, reutilizando as primitivas de filesystem/SQLite existentes.

`admin-import-service.ts` é o orquestrador único do pipeline de importação e reutiliza os managers existentes.

`backup-service.ts` separa CLI de backup/restore, preservando guarda offline, validação, rollback e compensação.

### TvRemoteSessionManager

`tv-remote-session-manager.ts` é um manager process-local e efêmero:

- possui sessões remotas por `request.user.id`;
- gera IDs opacos;
- limita a três sessões por usuário e remove a mais antiga na quarta;
- expira sessões após 60 s sem heartbeat/snapshot da TV;
- mantém no máximo 32 eventos por sessão para replay curto;
- entrega comandos/snapshots/closed a assinantes;
- não persiste estado e não participa de backup;
- libera timers/listeners em `shutdown()`.

Ele não é uma segunda autoridade de playback. O manager só transporta estado descartável entre o player canônico da TV e o controlador autenticado.

## Infrastructure

`server-infrastructure.ts` constrói recursos compartilhados de processo: SQLite/stores, sessões, credenciais/admin users, histórico operacional, import queue, login rate limiter e cache de transcoding. Também coordena o fechamento desses recursos.

`track-media-infrastructure.ts` encapsula acesso seguro à mídia, cache de capas, lyrics e transcoding.

O `TvRemoteSessionManager` é criado diretamente no composition root porque é process-local, não persistente e possui lifecycle próprio ligado ao Fastify.

## Autenticação e autorização

`auth-policy.ts` continua sendo a fronteira central e **fail-closed** da API.

`index.ts` instala `installApiAuthPolicy(...)` antes de registrar os domínios. `tv-remote-routes.ts` não instala política paralela.

A classificação permanece:

```text
public
  ↓
authenticated
  ↓
admin
```

As rotas `/api/tv-remote/*` são autenticadas e suas mutações exigem a proteção anti-CSRF central `X-Home-Music-Request: 1`.

Ownership remoto é derivado somente de `request.user.id`. Sessão inexistente, expirada ou de outro usuário retorna o mesmo 404, evitando enumeração.

## REST + SSE do controle TV

`registerTvRemoteRoutes(app, manager)` expõe:

- criação de sessão;
- leitura de resumo/snapshot;
- atualização de snapshot/heartbeat;
- publicação de comando;
- DELETE de sessão;
- stream SSE autenticado.

O SSE usa IDs crescentes, replay por `Last-Event-ID`, heartbeat de transporte e cleanup ao fechar request. O stream não renova TTL; a TV precisa continuar publicando status.

## Estado compartilhado

Não existe segundo snapshot canônico da biblioteca, segundo owner de transcoding, segundo pipeline de importação nem segundo player:

- `LibraryService` possui o snapshot canônico em memória;
- `PersonalLibraryService` consulta esse snapshot;
- `ServerInfrastructure` possui stores/managers persistentes;
- `TrackMediaInfrastructure` recebe os mesmos objetos por referência;
- `AdminImportService` reutiliza fila/managers existentes;
- `TvRemoteSessionManager` mantém apenas sessão/eventos efêmeros e snapshots de apresentação, nunca estado canônico do player.

## Lifecycle

Startup:

1. carregar `.env` e configuração;
2. criar Fastify;
3. construir infraestrutura, serviços e managers;
4. instalar auth policy e registrar rotas, inclusive TV remote;
5. preparar frontend em produção;
6. carregar biblioteca;
7. sondar FFmpeg;
8. iniciar Fastify;
9. habilitar auto-rescan quando configurado.

Shutdown:

1. scheduler automático é parado;
2. scan em andamento é aguardado antes de fechar SQLite;
3. `app.close()` executa hooks dos módulos;
4. o hook do TV remote chama `TvRemoteSessionManager.shutdown()`, fecha sessões/streams e limpa timer;
5. infraestrutura compartilhada é fechada.

## Invariantes

Mudanças futuras devem preservar:

- auth central/fail-closed;
- `index.ts` sem handlers `/api/*` inline;
- rotas pessoais sem reimplementar regras já extraídas;
- operações físicas administrativas nos serviços/stores responsáveis;
- um único pipeline de importação;
- backup/restore com validação, guarda offline e rollback;
- filesystem/transcoding atrás das interfaces responsáveis;
- estado da biblioteca em uma fonte única;
- TV remote process-local, owner-aware e sem persistência;
- snapshots remotos como apresentação descartável, não estado canônico;
- shutdown sem deixar timer/listeners/SSE do controle remoto ativos;
- SQLite nunca fechado enquanto scan conhecido ainda está ativo.

`server-composition.test.ts` protege as fronteiras estruturais. Testes de rotas/managers, security suite, backup smoke e Playwright protegem comportamento nas respectivas fronteiras.
