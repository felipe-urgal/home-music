# TV Remote Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an authenticated phone control the active Home Music TV player through a short-lived QR-paired session.

**Architecture:** A process-local `TvRemoteSessionManager` owns ephemeral sessions and an authenticated REST + SSE route module. The TV remains the only playback authority: it consumes validated commands and publishes snapshots, while `/remote/<sessionId>` renders a controller above `AuthenticatedApp` so the phone never creates a second audio player.

**Tech Stack:** TypeScript, Fastify 5, React 19, Server-Sent Events, Node test runner, Vitest, Playwright, `qrcode` 1.5.4.

**Spec:** `docs/superpowers/specs/2026-09-12-tv-remote-control-design.md`

## Global Constraints

- MVP commands are exactly play/pause, previous, next, seek -10 seconds, and seek +10 seconds.
- The TV is the sole playback authority; the phone must not mount `AuthenticatedApp`, `useAudioPlayer`, or an `<audio>` element.
- Every API route is authenticated by the existing central `/api/*` policy; every mutation requires `X-Home-Music-Request: 1`.
- Ownership comes only from `request.user.id`; a missing, expired, or other-user session returns the same 404 response.
- Sessions are process-local, allow at most three active sessions per user, expire after 60 seconds without a TV heartbeat, and are not persisted or backed up.
- Event IDs increase monotonically per session; retain only the latest 32 events for `Last-Event-ID` replay.
- QR generation is local to the browser and never calls an external service.
- The volume system, library browsing, queue editing, offline mode, and multi-TV control remain out of scope.

---

### Task 1: Shared contracts and session manager

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/server/src/tv-remote-session-manager.ts`
- Create: `apps/server/src/tv-remote-session-manager.test.ts`

**Interfaces:**
- Produces: `TvRemoteCommand`, `TvRemotePlaybackSnapshot`, `TvRemoteSessionSummary`, `TvRemoteEvent`.
- Produces: `TvRemoteSessionManager` with `create`, `get`, `publishCommand`, `publishSnapshot`, `subscribe`, `close`, and `shutdown`.
- Consumes: authenticated string user IDs from the existing server auth context; no client-provided ownership.

- [ ] **Step 1: Write failing manager tests**

Cover the observable breaks with literal expectations:

```ts
test('a fourth session evicts the oldest session owned by the user', () => {
  const manager = managerAt(0);
  const first = manager.create('user-7');
  manager.create('user-7');
  manager.create('user-7');
  manager.create('user-7');
  assert.equal(manager.get('user-7', first.id), null);
});

test('another user cannot observe or command a session', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  assert.equal(manager.get('user-8', session.id), null);
  assert.equal(manager.publishCommand('user-8', session.id, { type: 'next' }), false);
});

test('a session expires 60 seconds after its last TV heartbeat', () => {
  let now = 0;
  const manager = managerAt(() => now);
  const session = manager.create('user-7');
  now = 59_999;
  assert.notEqual(manager.get('user-7', session.id), null);
  now = 60_000;
  assert.equal(manager.get('user-7', session.id), null);
});

test('replay returns only events newer than Last-Event-ID', () => {
  const manager = managerAt(0);
  const session = manager.create('user-7');
  manager.publishCommand('user-7', session.id, { type: 'previous' });
  manager.publishCommand('user-7', session.id, { type: 'next' });
  assert.deepEqual(manager.eventsAfter('user-7', session.id, 1)?.map(event => event.id), [2]);
});
```

Use injected `now`, `randomId`, and timer functions so tests exercise real manager behavior without sleeps or test-only production methods.

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
node --import tsx --test apps/server/src/tv-remote-session-manager.test.ts
```

Expected: fail because the shared contracts and manager do not exist.

- [ ] **Step 3: Add strict shared contracts**

Add these public shapes to the shared package and export them through its existing barrel:

```ts
export type TvRemoteCommand =
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; deltaSeconds: -10 | 10 };

export type TvRemotePlaybackSnapshot = {
  trackId: string | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  updatedAt: string;
};

export type TvRemoteSessionSummary = {
  id: string;
  expiresAt: string;
  snapshot: TvRemotePlaybackSnapshot | null;
};

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };
```

- [ ] **Step 4: Implement the minimal manager**

Use `crypto.randomUUID()` by default, per-user insertion order for the three-session cap, `lastTvHeartbeatAt + 60_000` for expiration, a 32-event ring buffer, and listener callbacks removed by the unsubscribe function. `get` and every mutation must first resolve by both owner and opaque ID.

The production constructor owns its cleanup interval and `shutdown()` clears only that owned timer/listeners. Do not add persistence or a public method used only by tests.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
node --import tsx --test apps/server/src/tv-remote-session-manager.test.ts
npm run typecheck -w @home-music/shared
npm run typecheck -w @home-music/server
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src apps/server/src/tv-remote-session-manager.ts apps/server/src/tv-remote-session-manager.test.ts
git commit -m "feat(tv): add remote session manager"
```

---

### Task 2: Authenticated REST and SSE routes

**Files:**
- Create: `apps/server/src/tv-remote-routes.ts`
- Create: `apps/server/src/tv-remote-routes.test.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/server-composition.test.ts`

**Interfaces:**
- Consumes: `TvRemoteSessionManager` and shared types from Task 1.
- Produces: `registerTvRemoteRoutes(app, manager)` and the six `/api/tv-remote/sessions` endpoints from the spec.

- [ ] **Step 1: Write failing route tests**

Register the real central auth policy and real route module on a Fastify test app. Prove:

```ts
assert.equal((await app.inject({ method: 'POST', url: '/api/tv-remote/sessions' })).statusCode, 401);
assert.equal((await authenticatedInject('POST', '/api/tv-remote/sessions', { csrf: false })).statusCode, 403);
assert.equal((await authenticatedInject('POST', '/api/tv-remote/sessions', { csrf: true })).statusCode, 201);
assert.equal((await otherUserInject('GET', `/api/tv-remote/sessions/${id}`)).statusCode, 404);
assert.equal((await authenticatedInject('POST', `/api/tv-remote/sessions/${id}/commands`, {
  csrf: true,
  payload: { type: 'seek', deltaSeconds: 11 }
})).statusCode, 400);
```

Also test valid command delivery, normalized snapshots, DELETE, and that `Last-Event-ID` is parsed only as a non-negative integer. Assert SSE frames from a real subscription helper, not source text.

- [ ] **Step 2: Run route tests and confirm RED**

Run:

```bash
node --import tsx --test apps/server/src/tv-remote-routes.test.ts
```

Expected: fail because `registerTvRemoteRoutes` does not exist.

- [ ] **Step 3: Implement runtime validation and routes**

Keep validation local and strict:

```ts
function parseCommand(value: unknown): TvRemoteCommand | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (body.type === 'toggle-play' || body.type === 'previous' || body.type === 'next') {
    return Object.keys(body).length === 1 ? { type: body.type } : null;
  }
  if (body.type === 'seek' && (body.deltaSeconds === -10 || body.deltaSeconds === 10)) {
    return Object.keys(body).length === 2 ? { type: 'seek', deltaSeconds: body.deltaSeconds } : null;
  }
  return null;
}
```

Normalize snapshots to finite non-negative time values, clamp `currentTime` to duration when duration is positive, trim title/artist, and reject extra/body-invalid fields. Route handlers use `request.user!.id` only. Return 404 with `{ error: 'Controle remoto não encontrado.' }` for missing, expired, and other-owner sessions.

For SSE, set `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, and `Connection: keep-alive`; call `reply.hijack()`, write retry/heartbeat frames, replay buffered events after `Last-Event-ID`, unsubscribe on request close, and never log payloads.

- [ ] **Step 4: Wire lifecycle in the composition root**

Create one manager in `index.ts`, register routes after `registerPersonalRoutes`, and add one `app.addHook('onClose', ...)` that calls `manager.shutdown()`. Extend the composition test to protect the new module boundary.

- [ ] **Step 5: Run focused server validation**

Run:

```bash
node --import tsx --test apps/server/src/tv-remote-session-manager.test.ts apps/server/src/tv-remote-routes.test.ts apps/server/src/server-composition.test.ts
npm run typecheck -w @home-music/server
```

Expected: all commands exit 0 with no leaked handles.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/tv-remote-routes.ts apps/server/src/tv-remote-routes.test.ts apps/server/src/index.ts apps/server/src/server-composition.test.ts
git commit -m "feat(tv): expose authenticated remote channel"
```

---

### Task 3: Browser protocol, routing, and player command adapter

**Files:**
- Create: `apps/web/src/tv-remote-client.ts`
- Create: `apps/web/src/tv-remote-client.test.ts`
- Create: `apps/web/src/tv-remote-command.ts`
- Create: `apps/web/src/tv-remote-command.test.ts`
- Modify: `apps/web/src/browser-navigation.ts`
- Modify: `apps/web/src/browser-navigation.test.ts`

**Interfaces:**
- Consumes: shared remote contracts and the existing `apiFetch`/anti-CSRF pattern.
- Produces: `parseRemoteSessionPath`, `remoteSessionPath`, REST helpers, `openTvRemoteEvents`, and `applyTvRemoteCommand`.

- [ ] **Step 1: Write failing web tests**

Add table-driven literal expectations:

```ts
expect(parseRemoteSessionPath('/remote/abc-123')).toBe('abc-123');
expect(parseRemoteSessionPath('/remote/')).toBeNull();
expect(parseRemoteSessionPath('/remote/a/b')).toBeNull();
expect(remoteSessionPath('abc/123')).toBe('/remote/abc%2F123');
```

For the command adapter, call real callback functions and verify each command changes only its intended observable counter/value. For the client, fake only `fetch`/`EventSource`, mirror complete responses, and assert API URL, credentials, anti-CSRF header, cleanup, event decoding, and rejection of malformed event JSON.

- [ ] **Step 2: Run web tests and confirm RED**

Run:

```bash
npm run test -w @home-music/web -- src/tv-remote-client.test.ts src/tv-remote-command.test.ts src/browser-navigation.test.ts
```

Expected: fail because the remote modules and route parser do not exist.

- [ ] **Step 3: Implement route and command boundaries**

`parseRemoteSessionPath` accepts exactly one non-empty decoded segment after `/remote/` and rejects malformed encoding. `applyTvRemoteCommand` has this interface:

```ts
export function applyTvRemoteCommand(
  command: TvRemoteCommand,
  controls: {
    togglePlay: () => void | Promise<void>;
    previous: () => void;
    next: () => void;
    seekBy: (deltaSeconds: -10 | 10) => void;
  }
): void
```

- [ ] **Step 4: Implement the HTTP/SSE client**

Use `apiFetch` for GET and a private `mutationFetch` wrapper that adds `X-Home-Music-Request: 1`. Export exact helpers for create/get/status/command/delete. `openTvRemoteEvents(sessionId, handlers)` creates one same-origin `EventSource`, parses typed `command`, `snapshot`, and `closed` events, tracks the largest processed numeric event ID to deduplicate replays, reports transport status, and returns a cleanup function that closes the source.

- [ ] **Step 5: Run focused tests and web typecheck**

Run:

```bash
npm run test -w @home-music/web -- src/tv-remote-client.test.ts src/tv-remote-command.test.ts src/browser-navigation.test.ts
npm run typecheck -w @home-music/web
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/tv-remote-client.ts apps/web/src/tv-remote-client.test.ts apps/web/src/tv-remote-command.ts apps/web/src/tv-remote-command.test.ts apps/web/src/browser-navigation.ts apps/web/src/browser-navigation.test.ts
git commit -m "feat(tv): add remote browser protocol"
```

---

### Task 4: TV pairing and mobile controller surfaces

**Files:**
- Create: `apps/web/src/useTvRemoteSession.ts`
- Create: `apps/web/src/tv-remote-tv-controller.ts`
- Create: `apps/web/src/tv-remote-tv-controller.test.ts`
- Create: `apps/web/src/components/TvRemotePairingDialog.tsx`
- Create: `apps/web/src/components/TvRemoteControlScreen.tsx`
- Create: `apps/web/src/tv-remote.css`
- Create: `e2e/tests/tv-remote-control.spec.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/AuthenticatedApp.tsx`
- Modify: `apps/web/src/components/TvExperience.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: Task 3 client/adapter and canonical player callbacks/state.
- Produces: pairing dialog on TV and authenticated controller at `/remote/<sessionId>`.

- [ ] **Step 1: Install the local QR dependency**

Run:

```bash
npm install qrcode@1.5.4 @types/qrcode@1.5.5 -w @home-music/web
```

Do not add another runtime or QR service.

- [ ] **Step 2: Write failing TV-controller and route-selection tests**

Test these behaviors before UI implementation:

- session creation happens only after `openPairing()`;
- snapshot publication is throttled and heartbeat keeps the session alive;
- duplicate command IDs execute once;
- cleanup closes EventSource, cancels timers, and attempts DELETE;
- a pure `authenticatedSurfaceForPath('/remote/abc')` selector returns `{ type: 'remote', sessionId: 'abc' }` while ordinary paths return `{ type: 'app' }`.

Implement these tests against a real framework-independent `TvRemoteTvController`; inject clock/timers and a complete in-memory client double. Assertions target resulting session state and callback effects, not mock existence. The React hook is a thin lifecycle adapter over this tested controller.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm run test -w @home-music/web -- src/tv-remote-tv-controller.test.ts src/browser-navigation.test.ts
```

Expected: fail because the hook/surfaces do not exist.

- [ ] **Step 4: Implement `useTvRemoteSession`**

First implement `TvRemoteTvController`, the framework-independent owner of session creation, SSE, throttling, heartbeat, deduplication and cleanup proven by Step 2. Then implement `useTvRemoteSession` as a thin React lifecycle/state adapter. The hook is disabled outside TV mode. `openPairing()` creates a session, builds `${window.location.origin}${remoteSessionPath(id)}`, starts SSE, and publishes a snapshot immediately. It maps commands to the canonical player with `applyTvRemoteCommand`; seek reads the latest player time and calls the existing absolute `player.seek(clampTvSeek(currentTime, duration, delta))`.

Publish on material state changes with at most one update per second and send a heartbeat/status at least every 15 seconds. Cleanup cancels all timers, closes the stream, and attempts session deletion with the mutation client.

- [ ] **Step 5: Implement the pairing dialog**

Generate an SVG data URL locally with:

```ts
await QRCode.toString(pairingUrl, {
  type: 'svg',
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 280
});
```

Render the SVG without `dangerouslySetInnerHTML` by converting it to a `data:image/svg+xml` URL for `<img>`. The modal has a labelled heading, close action, focus entry/return, Escape handling, waiting/connected/error copy, the textual URL, and **Gerar novo código**.

- [ ] **Step 6: Implement the phone controller above `AuthenticatedApp`**

In `App.tsx`, derive `remoteSessionId` from `window.location.pathname`. Preserve the existing loading/login/offline authority, then render:

```tsx
if (remoteSessionId) {
  return <TvRemoteControlScreen sessionId={remoteSessionId} username={auth.currentUser.username} />;
}
```

The screen validates the session, opens SSE, shows connection/expired/error states, renders current title/artist/progress, and sends exactly the five allowed commands. Disable only the command currently in flight and expose accessible names for icon buttons.

- [ ] **Step 7: Connect TV presentation to the canonical player**

Instantiate the hook in `AuthenticatedApp` with current player state and callbacks. Pass presentation props to `TvExperience`; add a compact phone/remote icon action in the TV topbar and render `TvRemotePairingDialog` outside the focus-zone navigation root so modal focus is isolated.

Import `tv-remote.css` from `main.tsx`. Keep touch targets at least 48px, support `forced-colors` and `prefers-reduced-motion`, and do not expose the controller in normal desktop/mobile navigation.

- [ ] **Step 8: Run focused UI validation**

Run:

```bash
npm run test -w @home-music/web -- src/tv-remote-tv-controller.test.ts src/tv-remote-client.test.ts src/tv-remote-command.test.ts src/browser-navigation.test.ts
npm run typecheck -w @home-music/web
npm run build -w @home-music/web
```

Expected: all commands exit 0 and bundle budget remains below its existing thresholds.

- [ ] **Step 9: Write the failing two-context E2E scenario**

Use two browser contexts against the real disposable E2E server. Authenticate both as the same fixture account, open TV with `/?tv=1`, create a pairing session through the visible TV UI, obtain the pairing href from the dialog, and open it in the mobile context. Assert there is no `<audio>` element in the phone context, then prove through visible TV state that play/pause, next, and seek commands arrive. Also authenticate a second account and assert its GET and command POST both return 404 for the first user's session. Do not use arbitrary sleeps; wait on UI or HTTP state.

- [ ] **Step 10: Run the E2E and fix only demonstrated integration gaps**

Run:

```bash
npm run build
npm run test --prefix e2e -- tests/tv-remote-control.spec.ts --project=desktop-chromium
```

Expected before final integration: fail at the first missing/incorrect observable contract, then pass after the smallest integration corrections.

- [ ] **Step 11: Commit**

```bash
git add apps/web e2e/tests/tv-remote-control.spec.ts package-lock.json
git commit -m "feat(tv): control playback from phone"
```

---

### Task 5: Documentation and CI gate

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/android-tv.md`
- Modify: `docs/app-composition.md`
- Modify: `docs/server-composition.md`
- Modify: `docs/testing-and-quality.md`
- Modify: `e2e/README.md`

**Interfaces:**
- Consumes: complete remote-control flow and E2E proof from Tasks 1-4.
- Produces: documented lifecycle and a fixed CI regression gate.

- [ ] **Step 1: Add the focused CI gate**

After the existing mobile crossfade step, add:

```yaml
- name: TV remote control E2E
  run: npm run test --prefix e2e -- tests/tv-remote-control.spec.ts --project=desktop-chromium
```

- [ ] **Step 2: Update living documentation**

Document the exact MVP commands, same-account requirement, 60-second TV heartbeat expiry, three-session cap, process-local lifecycle, controller-above-`AuthenticatedApp` composition, manager ownership/shutdown, hardware limitations, and the new fixed CI order. Do not claim BTV hardware validation was executed.

- [ ] **Step 3: Run final risk gates**

Run:

```bash
npm run check
npm run test:security
npm run smoke:backup-restore
npm run test --prefix e2e -- tests/crossfade-mobile.spec.ts --project=mobile-chromium
npm run test --prefix e2e -- tests/tv-remote-control.spec.ts --project=desktop-chromium
npm run test --prefix e2e -- tests/personal-data-import.spec.ts
```

Expected: every command exits 0. If the local sandbox blocks Chromium or `tsx` IPC, record the exact limitation and require the identical GitHub CI run on the final head before completion.

- [ ] **Step 4: Review the complete diff**

Review `git diff origin/main...HEAD` for scope, auth/ownership, SSE cleanup, timers, stale async work, responsive/accessibility behavior, secret leakage, documentation accuracy, and accidental generated files. Correct findings and rerun affected gates.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml e2e/tests/tv-remote-control.spec.ts e2e/README.md docs/android-tv.md docs/app-composition.md docs/server-composition.md docs/testing-and-quality.md
git commit -m "test(tv): cover phone remote control"
```
