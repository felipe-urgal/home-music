# TV Remote Control Implementation Plan

**Status:** concluído no PR #393.

**Goal:** permitir que um celular autenticado na mesma conta controle o player ativo do Home Music TV por uma sessão efêmera pareada por QR.

**Architecture:** `TvRemoteSessionManager` process-local + REST/SSE autenticados no servidor. A TV continua sendo a única autoridade de reprodução: recebe comandos e publica snapshots. A rota `/remote/<sessionId>` é resolvida por `App.tsx` antes de `AuthenticatedApp`, então o celular não monta player nem cria `<audio>`.

**Tech Stack final:** TypeScript, Fastify 5, React 19, Server-Sent Events, Node test runner, Vitest e Playwright. O QR é gerado localmente por `apps/web/src/tv-remote-qr.ts`; nenhuma biblioteca ou serviço externo de QR foi adicionado.

**Spec:** `docs/superpowers/specs/2026-09-12-tv-remote-control-design.md`

## Constraints finais

- [x] comandos do MVP limitados a play/pause, anterior, próxima e seek ±10 s;
- [x] TV como única autoridade de playback;
- [x] celular sem `AuthenticatedApp`, `useAudioPlayer` ou `<audio>`;
- [x] autenticação central para todas as rotas;
- [x] `X-Home-Music-Request: 1` em todas as mutações;
- [x] ownership derivado somente de `request.user.id`;
- [x] missing/expired/other-owner indistinguíveis por 404;
- [x] até três sessões por usuário;
- [x] expiração após 60 s sem heartbeat da TV;
- [x] buffer dos últimos 32 eventos para replay SSE;
- [x] QR local, sem chamada externa;
- [x] volume, navegação de biblioteca, edição de fila, offline e multi-TV fora do escopo.

## Task 1 — contratos e session manager

- [x] adicionar `TvRemoteCommand`, `TvRemotePlaybackSnapshot`, `TvRemoteSessionSummary` e `TvRemoteEvent` em `@home-music/shared`;
- [x] implementar `TvRemoteSessionManager` com create/get/publish/subscribe/close/shutdown;
- [x] proteger TTL, cap por usuário, replay, ownership e cleanup com testes determinísticos.

Arquivos principais:

- `packages/shared/src/index.ts`
- `apps/server/src/tv-remote-session-manager.ts`
- `apps/server/src/tv-remote-session-manager.test.ts`

## Task 2 — REST/SSE autenticados

- [x] registrar create/get/status/commands/delete/events em `/api/tv-remote/sessions`;
- [x] validar estritamente comandos e snapshots;
- [x] manter auth/CSRF na política central;
- [x] entregar replay por `Last-Event-ID`, heartbeat SSE e cleanup de stream;
- [x] ligar o manager ao composition root e ao shutdown do servidor;
- [x] cobrir HTTP/SSE real, ownership entre usuários, backpressure e shutdown.

Arquivos principais:

- `apps/server/src/tv-remote-routes.ts`
- `apps/server/src/tv-remote-routes.test.ts`
- `apps/server/src/index.ts`
- `apps/server/src/server-composition.test.ts`

## Task 3 — protocolo web e roteamento

- [x] criar cliente HTTP/SSE same-origin;
- [x] deduplicar replay pelo maior event ID processado;
- [x] criar `/remote/<sessionId>` com encoding seguro;
- [x] criar adaptador de comandos para o player canônico;
- [x] usar `keepalive` no DELETE best-effort de cleanup.

Arquivos principais:

- `apps/web/src/tv-remote-client.ts`
- `apps/web/src/tv-remote-command.ts`
- `apps/web/src/browser-navigation.ts`
- respectivos testes.

## Task 4 — pareamento na TV e controlador no celular

- [x] criar sessão somente após ação explícita na TV;
- [x] publicar snapshot inicial, mudanças materiais limitadas a ~1 Hz e heartbeat de 15 s;
- [x] criar QR SVG local com fallback de URL textual;
- [x] manter sessão ativa ao apenas esconder o overlay;
- [x] invalidar sessão anterior ao gerar novo código;
- [x] isolar D-pad dentro do modal e restaurar foco ao gatilho ao fechar;
- [x] criar `TvRemoteControlScreen` sem áudio local;
- [x] serializar comandos no celular para preservar ordem;
- [x] provar play/pause bidirecional, próxima e seek em E2E com dois contexts do mesmo usuário.

Arquivos principais:

- `apps/web/src/useTvRemoteSession.ts`
- `apps/web/src/tv-remote-tv-controller.ts`
- `apps/web/src/tv-remote-qr.ts`
- `apps/web/src/components/TvRemotePairingDialog.tsx`
- `apps/web/src/components/TvRemoteControlScreen.tsx`
- `e2e/tests/tv-remote-control.spec.ts`

## Task 5 — CI e documentação

- [x] adicionar `TV regression gate` antes do quality gate;
- [x] adicionar `TV remote control E2E` ao CI fixo;
- [x] documentar Android TV/BTV, composição frontend/backend, política de testes e E2E;
- [x] documentar segurança, lifecycle, limitações e homologação física restante;
- [x] manter a issue #392 aberta para hardware/distribuição, sem confundir CI verde com homologação física.

## Desvios conscientes do plano original

O desenho inicial previa `qrcode@1.5.4`. Durante a implementação foi escolhido um encoder QR local e testado, removendo a necessidade de pacote adicional e mantendo a garantia de que a URL não sai do navegador.

O plano inicial também sugeria concentrar todo o lifecycle em uma classe `TvRemoteTvController`. A implementação final mantém as transformações puras em `tv-remote-tv-controller.ts` e o lifecycle React em `useTvRemoteSession.ts`, sem criar uma segunda autoridade de playback.

A separação de ownership por outra conta é provada pelos testes HTTP reais de `tv-remote-routes.test.ts`. O Playwright focado usa dois contexts autenticados na mesma conta para provar a integração visível TV ↔ celular. Isso evita duplicar no navegador uma invariável já coberta na fronteira HTTP.

## Gates de conclusão

O HEAD final só deve ser considerado pronto quando o GitHub CI confirmar, no mesmo commit:

```text
TV regression gate
Quality gate
Security regression gate
Backup restore smoke
Mobile crossfade E2E
TV remote control E2E
Personal data import E2E
Library Assistant E2E
```

A validação no BTV 11 continua separada: leitura do QR/câmera, legibilidade a distância, foco real por D-pad, overscan e comportamento GeckoView precisam ser conferidos no hardware após deploy.
