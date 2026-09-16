# Home Music TV Offline LAN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o BTV 11 reproduza músicas já baixadas no PWA do celular com WAN e servidor Home Music totalmente indisponíveis, usando apenas a LAN local.

**Architecture:** O APK da TV hospeda um serviço HTTP LAN efêmero para bootstrap/sinalização e um receiver web offline embarcado servido por loopback no GeckoView. O PWA do celular permanece na origin original para preservar Cache Storage; após o handshake local, WebRTC DataChannel transporta mídia, comandos e estado sem backend.

**Tech Stack:** TypeScript/React/Vite, WebRTC DataChannel, Cache Storage/PWA, Java 17 Android TV, GeckoView 126, HTTP local, Playwright/Vitest/JVM tests.

**Spec:** GitHub Epic #416 e issues #417–#422.

## Global Constraints

- BTV 11 com `minSdk 23`, `targetSdk 35`, `compileSdk 35`.
- Manter GeckoView e não criar player de áudio nativo Java.
- O PWA do celular não navega para origin da TV; deve preservar Cache Storage existente.
- Backend Home Music deve ser dependência zero durante a sessão LAN estabelecida.
- HTTP LAN serve apenas bootstrap/autenticação efêmera/sinalização; áudio e comandos contínuos trafegam por WebRTC DataChannel.
- QR/sessão LAN não pode carregar credenciais Home Music.
- Preservar fluxo online existente de #413/#414.
- Cada issue #417–#422 corresponde a um commit lógico e um push; correções permanecem dentro do commit correspondente.

---

### Task 1: Protocolo LAN, threat model e compatibilidade (#417)

**Files:**
- Create: `docs/tv-offline-lan-protocol.md`
- Create: `packages/shared/src/tv-lan-remote.ts`
- Create: `packages/shared/src/tv-lan-remote.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: payload QR versionado, tipos de sessão/challenge/signaling, validadores, limites, TTL e utilitários de replay usados por Android e web.

- [ ] Definir contrato `home-music-lan-remote-v1`, payload do QR e limites explícitos.
- [ ] Escrever testes de serialização, validação, expiração e replay.
- [ ] Implementar os tipos/validadores mínimos até os testes passarem.
- [ ] Documentar threat model, Local Network Access, matriz de compatibilidade e roteiro do spike físico.
- [ ] Rodar testes compartilhados e `npm run check` relevante.
- [ ] Commitar como `docs: define offline LAN TV protocol`.

### Task 2: Serviço LAN efêmero no APK (#418)

**Files:**
- Create: `android-tv/app/src/main/java/com/homemusic/tv/LanPairingServer.java`
- Create: `android-tv/app/src/main/java/com/homemusic/tv/LanPairingSession.java`
- Create: `android-tv/app/src/main/java/com/homemusic/tv/LanAddressResolver.java`
- Create tests under: `android-tv/app/src/test/java/com/homemusic/tv/`
- Modify: `android-tv/app/src/main/java/com/homemusic/tv/MainActivity.java`
- Modify: `android-tv/app/build.gradle`
- Modify: `.github/workflows/android-tv.yml`

**Interfaces:**
- Consumes: contrato/limites de #417.
- Produces: listener LAN + loopback, sessão efêmera autenticada, polling de sinais e lifecycle determinístico.

- [ ] Escrever testes JVM para TTL, segredo de uso único, replay, mailbox, limits e address resolver.
- [ ] Implementar sessão/challenge e listener HTTP com CORS/LNA.
- [ ] Integrar lifecycle no `MainActivity` sem deixar listener órfão.
- [ ] Adicionar teste/build Android ao CI.
- [ ] Rodar Gradle test/lint/build.
- [ ] Commitar como `feat(android-tv): add offline LAN pairing service`.

### Task 3: Receiver offline embarcado (#419)

**Files:**
- Create: `apps/web/src/tv-offline-receiver-entry.tsx`
- Create: `apps/web/src/TvOfflineReceiver.tsx`
- Create focused tests for receiver/bootstrap.
- Modify/refactor: TV peer/media/player modules to share backend-independent pieces.
- Modify: Vite/build configuration for dedicated receiver bundle.
- Modify: Android Gradle build to package receiver assets.
- Modify: `MainActivity.java` to open loopback receiver on demand/fallback.

**Interfaces:**
- Consumes: serviço loopback de #418 e peer/media protocol existente.
- Produces: receiver GeckoView cold-startable sem backend, playback por Blob/object URL no player web compartilhado.

- [ ] Extrair somente o código backend-independent necessário do receiver/player existente.
- [ ] Implementar entrypoint offline sem `/api/*` obrigatório no bootstrap.
- [ ] Empacotar assets deterministicamente no APK e servir por loopback.
- [ ] Implementar modo/fallback explícito no APK.
- [ ] Testar cleanup de peer/blob e regressão online.
- [ ] Commitar como `feat(android-tv): embed offline TV receiver`.

### Task 4: Controle offline dentro do PWA (#420)

**Files:**
- Create: `apps/web/src/tv-lan-pairing.ts`
- Create: `apps/web/src/tv-lan-remote-client.ts`
- Create tests for QR/LNA/timeouts/cleanup.
- Modify: `apps/web/src/OfflineApp.tsx`
- Modify/add focused UI components for Connect to TV / QR scanner.

**Interfaces:**
- Consumes: protocolo #417 e serviço #418.
- Produces: sessão LAN origin-preserving capaz de ler cache offline e abrir signaling local sem backend.

- [ ] Implementar parse/validação do QR e handshake local.
- [ ] Implementar polling/signaling LAN com abort/cleanup.
- [ ] Adicionar ação `Conectar à TV` no modo offline, scanner/fallback manual e estados LNA.
- [ ] Garantir zero request `/api/*` no fluxo LAN e reuso do cache offline existente.
- [ ] Testar permissões negadas, browser incompatível e rede inalcançável.
- [ ] Commitar como `feat(web): connect offline PWA to TV over LAN`.

### Task 5: Unificar sessão e mover controles para DataChannel (#421)

**Files:**
- Create/refactor session transport facade in `apps/web/src/`.
- Modify: `tv-remote-client.ts`, `tv-remote-peer.ts`, `tv-remote-media.ts`, `TvRemoteControlSurface.tsx`, `useTvRemoteSession.ts` and focused tests.
- Modify shared protocol types as required.

**Interfaces:**
- Produces: adapters `server` e `lan` sob a mesma interface; comandos/estado contínuos via DataChannel.

- [ ] Escrever testes de contrato para adapters e controles.
- [ ] Introduzir facade de signaling/session sem mudar comportamento online.
- [ ] Estender framing DataChannel para comandos/estado mantendo mídia binária e backpressure seguros.
- [ ] Integrar queue offline e ordenação `media-ready` → `play-track`.
- [ ] Validar reconnect/cleanup/version mismatch e zero backend no modo LAN.
- [ ] Commitar como `feat(remote): unify online and LAN TV sessions`.

### Task 6: Regressão, E2E, docs e QA (#422)

**Files:**
- Create: `e2e/tests/tv-offline-lan.spec.ts`
- Modify: `.github/workflows/ci.yml`, `.github/workflows/android-tv.yml`
- Modify: `docs/tv-offline-cast.md`, `docs/tv-remote-control.md`, `docs/android-tv.md`, `android-tv/README.md`, `e2e/README.md`.

**Interfaces:**
- Validates: todas as tasks anteriores no mesmo head final.

- [ ] Criar fixture/E2E com backend indisponível e cache offline pré-semeado.
- [ ] Validar WebRTC/DataChannel real em Chromium quando suportado pelo harness.
- [ ] Preservar E2Es online existentes e isolamento de servidor/DB.
- [ ] Atualizar docs com roteiro WAN/server off, limitações e recuperação online.
- [ ] Rodar `npm run check`, regressão TV, segurança, E2Es relevantes e Gradle test/lint/build.
- [ ] Registrar QA físico BTV 11 como critério final se não for executável no CI.
- [ ] Commitar como `test: validate fully offline TV LAN mode`.

## Self-review

- Cobertura: #417–#422 mapeadas 1:1 para seis tasks/commits.
- Segurança: QR efêmero, replay/TTL, nenhuma credencial Home Music e cleanup explícitos.
- Compatibilidade: primeiro task mantém gate físico para Local Network Access/WebRTC no BTV 11.
- Regressão: modo online #413/#414 permanece requisito em Tasks 3, 5 e 6.
- Sem placeholders: execução deve usar nomes/interfaces acima ou ajustar de forma consistente dentro do mesmo commit da task.
