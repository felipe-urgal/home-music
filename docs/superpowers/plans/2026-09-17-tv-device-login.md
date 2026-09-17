# TV Device Login Implementation Plan

**Status:** implementação automatizada concluída nos PRs #429 e #431; QA físico BTV + iPhone pendente.

**Goal:** permitir que a experiência TV seja autenticada por aprovação no celular, sem digitar senha no controle remoto e sem transferir credenciais/sessão do celular para a TV.

**Architecture:** `TvDeviceLoginManager` efêmero + REST no servidor. A TV cria uma solicitação e conserva um segredo privado; o QR leva um token de aprovação ao celular; o celular autenticado autoriza; a TV consome a autorização uma única vez e recebe uma sessão normal criada por `SessionManager.createSessionForUser`.

**Tech Stack:** TypeScript, Fastify 5, React 19, Node test runner, Vitest e Playwright. O app Android TV já abre o servidor com `?tv=1`, que será usado para priorizar a experiência de device login na TV sem alterar a autenticação dos navegadores comuns.

**Spec:** `docs/superpowers/specs/2026-09-17-tv-device-login-design.md`

## Constraints

- [x] senha, cookie e token da sessão do celular nunca chegam à TV;
- [x] TV recebe uma sessão própria e revogável;
- [x] QR usa token de aprovação efêmero, separado do segredo da TV;
- [x] token de aprovação fica no fragmento da URL e é removido da barra após leitura;
- [x] código curto serve apenas para confirmação visual;
- [x] autorização é de uso único e expira em 5 minutos;
- [x] estado efêmero não cria migration nem entra em backup;
- [x] mutações mantêm `X-Home-Music-Request: 1`;
- [x] login tradicional continua disponível como fallback;
- [x] fluxo permanece separado do bridge LAN/WebRTC/offline;
- [x] implementação dividida em dois PRs pequenos e revisáveis.

# PR 1 — protocolo, backend e segurança

**PR:** #429 — concluído e mergeado.

Objetivo do primeiro PR: entregar e provar a autorização efêmera até a criação da sessão da TV, sem alterar ainda a tela principal de login.

## Task 1 — contratos do manager

**Concluída.**

## Task 2 — rotas HTTP do device login

**Concluída.**

Contrato entregue:

```text
POST /api/auth/device/start
GET  /api/auth/device/:requestId/status
POST /api/auth/device/approve
POST /api/auth/device/deny
POST /api/auth/device/:requestId/consume
DELETE /api/auth/device/:requestId
```

## Task 3 — criar a sessão própria da TV

**Concluída.** A TV recebe sessão própria criada pelo `SessionManager`, independente da sessão do celular e sujeita ao fluxo normal de revogação.

## Task 4 — abuse protection e observabilidade segura

**Concluída.** Rate limits, caps, `Retry-After`, hashing de segredos e ausência de tokens completos em respostas/logs sensíveis foram cobertos pelos testes do protocolo.

## Gate do PR 1

- [x] testes do manager verdes;
- [x] testes HTTP reais das rotas verdes;
- [x] regressão de autenticação verde;
- [x] CI no HEAD do PR verde;
- [x] replay, CSRF, expiração e isolamento de sessão cobertos.

# PR 2 — TV, celular e E2E

**PR:** #431 — implementação concluída; aguardando conclusão do fluxo de review/merge.

Objetivo do segundo PR: expor o protocolo aprovado na experiência real sem alterar o fallback existente de usuário/senha.

## Task 5 — cliente web e token do QR

**Concluída.** Cliente web cobre start/status/preview/approve/deny/consume/cancel; approval token permanece no fragmento da URL e é removido da barra após leitura.

## Task 6 — tela de login da TV

**Concluída.** `?tv=1` prioriza QR + código curto + polling, com regeneração e fallback explícito para usuário/senha.

## Task 7 — superfície de aprovação no celular

**Concluída.** `/tv-login#token` preserva a intenção durante login, remove o fragmento sensível e permite autorizar/recusar comparando o código curto.

## Task 8 — E2E com TV + celular

**Concluída no CI.** O E2E usa contexts isolados de TV e celular, valida autorização, sessões independentes, logout independente, regeneração e fallback por senha. As regressões de controle remoto e cast offline continuam separadas e verdes.

## Task 9 — documentação final e QA físico

Estado atual:

- [x] registrar PRs #429 e #431 e o estado automatizado final;
- [x] registrar o que foi comprovado por CI;
- [ ] validar BTV real + iPhone conforme checklist da spec;
- [ ] registrar o resultado da homologação física;
- [ ] atualizar a spec caso o QA físico revele alguma decisão diferente do desenho atual.

## Divisão entregue

### PR 1 — #429 — `feat(auth): adicionar protocolo de login da TV pelo celular`

Backend/protocolo/segurança/testes. Mergeado.

### PR 2 — #431 — `feat(tv): entrar na TV com o celular`

Frontend TV + celular + E2E + regressões de compatibilidade. Pronto para review após os gates automatizados.

## Gates de conclusão

Comprovado por CI:

```text
TV gera solicitação de login
celular autenticado autoriza
celular deslogado autentica e retorna à aprovação
código curto coincide
TV recebe sessão própria
logout da TV não desloga celular
regeneração funciona
fallback por usuário/senha continua funcional
regressões TV remote/offline permanecem independentes
```

Ainda exige homologação física:

```text
BTV real exibe e mantém a experiência corretamente
Safari/iPhone lê o QR real
fluxo completo funciona na rede/dispositivos reais
refresh/reabertura da BTV mantém sessão
expiração/regeneração são confirmadas na interação física
```

O fluxo offline LAN não faz parte deste gate; ele permanece uma regressão separada e não depende do device login online.
