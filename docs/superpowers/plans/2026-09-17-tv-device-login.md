# TV Device Login Implementation Plan

**Status:** pendente.

**Goal:** permitir que a experiência TV seja autenticada por aprovação no celular, sem digitar senha no controle remoto e sem transferir credenciais/sessão do celular para a TV.

**Architecture:** `TvDeviceLoginManager` efêmero + REST no servidor. A TV cria uma solicitação e conserva um segredo privado; o QR leva um token de aprovação ao celular; o celular autenticado autoriza; a TV consome a autorização uma única vez e recebe uma sessão normal criada por `SessionManager.createSessionForUser`.

**Tech Stack:** TypeScript, Fastify 5, React 19, Node test runner, Vitest e Playwright. O app Android TV já abre o servidor com `?tv=1`, que será usado para priorizar a experiência de device login na TV sem alterar a autenticação dos navegadores comuns.

**Spec:** `docs/superpowers/specs/2026-09-17-tv-device-login-design.md`

## Constraints

- [ ] senha, cookie e token da sessão do celular nunca chegam à TV;
- [ ] TV recebe uma sessão própria e revogável;
- [ ] QR usa token de aprovação efêmero, separado do segredo da TV;
- [ ] token de aprovação fica no fragmento da URL e é removido da barra após leitura;
- [ ] código curto serve apenas para confirmação visual;
- [ ] autorização é de uso único e expira em 5 minutos;
- [ ] estado efêmero não cria migration nem entra em backup;
- [ ] mutações mantêm `X-Home-Music-Request: 1`;
- [ ] login tradicional continua disponível como fallback;
- [ ] fluxo permanece separado do bridge LAN/WebRTC/offline;
- [ ] implementação dividida em dois PRs pequenos e revisáveis.

# PR 1 — protocolo, backend e segurança

Objetivo do primeiro PR: entregar e provar a autorização efêmera até a criação da sessão da TV, sem alterar ainda a tela principal de login.

## Task 1 — contratos do manager

**Arquivos:**

- criar `apps/server/src/tv-device-login-manager.ts`;
- criar `apps/server/src/tv-device-login-manager.test.ts`.

**RED**

Adicionar testes para:

- criação de uma solicitação `pending` com TTL;
- unicidade de `requestId`, `deviceToken` e `approvalToken`;
- lookup da TV somente com segredo correto;
- approval token somente em estado válido;
- `pending -> approved -> consumed`;
- `pending -> denied`;
- expiração;
- replay de approve/deny/consume;
- caps globais e por origem;
- cleanup de entradas expiradas;
- segredos armazenados somente como hash.

**GREEN**

Implementar `TvDeviceLoginManager` com API pequena, preferindo operações que expressem as transições em vez de expor o `Map` interno. O estado público permanece `pending | approved | denied | expired | consumed`.

O consumo deve suportar reserva/commit/rollback interno para que falha ao criar a sessão autenticada não marque a autorização como consumida. Um estado interno temporário pode existir, mas não faz parte do contrato HTTP.

## Task 2 — rotas HTTP do device login

**Arquivos:**

- criar `apps/server/src/tv-device-login-routes.ts`;
- criar `apps/server/src/tv-device-login-routes.test.ts`;
- ajustar `apps/server/src/index.ts` para compor manager/rotas;
- ajustar `packages/shared/src/index.ts` somente para tipos realmente compartilhados entre server e web.

**RED**

Testar HTTP real para o contrato conceitual:

```text
POST /api/auth/device/start
GET  /api/auth/device/:requestId/status
POST /api/auth/device/approve
POST /api/auth/device/deny
POST /api/auth/device/:requestId/consume
DELETE /api/auth/device/:requestId
```

Regras:

- `start`, `status`, `consume` e cancelamento da TV são acessíveis sem sessão de usuário, mas exigem o segredo da TV onde aplicável;
- `approve` e `deny` exigem sessão autenticada no celular;
- todas as mutações exigem `X-Home-Music-Request: 1` pela política central;
- `Cache-Control: no-store` em todas as respostas;
- segredo inválido não revela se `requestId` existe;
- polling não devolve identidade do usuário;
- approval token inválido/expirado não revela detalhes internos;
- payloads/tokens têm limites de tamanho antes de hash/lookup.

**GREEN**

Registrar as rotas com `config.auth: 'public'` apenas onde a sessão de usuário realmente não existe. Para aprovação/recusa, deixar a política autenticada padrão derivar `request.user.id`; nunca aceitar `userId` no body.

O segredo da TV deve ser enviado em header dedicado, nunca em query string. O approval token chega no body da mutação autenticada do celular.

## Task 3 — criar a sessão própria da TV

**Arquivos:**

- `apps/server/src/tv-device-login-routes.ts`;
- `apps/server/src/tv-device-login-routes.test.ts`;
- reaproveitar `apps/server/src/auth.ts` sem duplicar session store;
- alterar `apps/server/src/auth-routes.ts` somente se surgir helper realmente compartilhável de cookie/secure request.

**RED**

Provar que:

- consumo aprovado chama a criação de sessão para o usuário associado;
- resposta usa `Set-Cookie` com a mesma política do login normal;
- `/api/auth/status` reconhece imediatamente a nova sessão;
- cookie da TV é diferente do cookie do celular;
- segundo consume não cria segunda sessão;
- capacidade global esgotada retorna erro recuperável sem perder a aprovação;
- sessão criada aparece em `/api/auth/sessions` e pode ser revogada normalmente.

**GREEN**

Reutilizar `SessionManager.createSessionForUser`, `buildSessionCookie` e `SESSION_COOKIE_MAX_AGE_SECONDS`. Se a extração de um helper evitar divergência entre password login e device login, fazer a menor refatoração possível e proteger o comportamento atual com os testes já existentes de `auth-routes.test.ts`.

## Task 4 — abuse protection e observabilidade segura

**Arquivos:**

- `apps/server/src/tv-device-login-manager.ts`;
- `apps/server/src/tv-device-login-routes.ts`;
- respectivos testes.

Cobrir:

- rate limit de `start` por origem/IP, usando a mesma política de IP confiável do login atual quando aplicável;
- capacidade global limitada e pequeno cap de pendências por origem;
- `Retry-After` quando o limite for atingido;
- nenhuma impressão de tokens completos em erro/log;
- cleanup no shutdown/composition root se o manager adquirir timer próprio.

Os números devem virar constantes nomeadas e testadas. Ajuste futuro desses limites não deve alterar o protocolo.

## Gate do PR 1

Antes de considerar o primeiro PR pronto:

- testes do manager verdes;
- testes HTTP reais das rotas verdes;
- regressão completa de `auth-routes`/`auth-policy` verde;
- CI no mesmo HEAD verde;
- revisão explícita de replay, CSRF, expiração e isolamento de sessão.

# PR 2 — TV, celular e E2E

Objetivo do segundo PR: expor o protocolo aprovado na experiência real sem alterar o fallback existente de usuário/senha.

## Task 5 — cliente web e token do QR

**Arquivos:**

- criar `apps/web/src/tv-device-login-client.ts`;
- criar `apps/web/src/tv-device-login-client.test.ts`;
- criar helper de rota/token junto de `apps/web/src/browser-navigation.ts` ou arquivo dedicado, conforme o menor acoplamento;
- respectivos testes.

**RED**

Testar:

- start/status/approve/deny/consume/cancel;
- header do segredo da TV;
- `X-Home-Music-Request: 1` nas mutações;
- leitura de `/tv-login#<approvalToken>`;
- remoção do fragmento com `history.replaceState` sem perder a intenção da rota;
- token inválido/ausente;
- polling interrompido ao desmontar ou chegar a estado terminal.

**GREEN**

Manter o cliente sem estado de UI. Ele apenas traduz HTTP e tipos.

## Task 6 — tela de login da TV

**Arquivos:**

- criar `apps/web/src/components/TvDeviceLoginScreen.tsx` e teste;
- ajustar `apps/web/src/App.tsx`;
- reaproveitar `apps/web/src/components/LoginScreen.tsx` como fallback;
- CSS no arquivo de autenticação existente ou arquivo TV específico, sem duplicar o layout base;
- reaproveitar a geração local de QR já existente quando o contrato de tamanho permitir.

O wrapper Android já transforma a URL configurada em `?tv=1` em `MainActivity.withTvMode`. Portanto, quando não autenticado e `tv=1`, `App.tsx` prioriza `TvDeviceLoginScreen`. Navegadores comuns continuam vendo o login atual.

Comportamento:

- start somente ao montar a superfície TV;
- QR + `displayCode` grandes;
- polling com intervalo curto e estável, sem request concorrente;
- ao observar `approved`, consumir uma única vez;
- depois do consume, chamar refresh da autenticação atual;
- regenerar cancela primeiro a solicitação anterior;
- unmount faz cancelamento best-effort;
- expirado/denied/erro nunca ficam em spinner infinito;
- botão **Entrar com usuário e senha** alterna para o `LoginScreen` existente;
- fallback oferece voltar para **Entrar com celular**.

Não alterar `android-tv/MainActivity.java` no MVP, salvo se QA provar que `?tv=1` não chega corretamente ao frontend.

## Task 7 — superfície de aprovação no celular

**Arquivos:**

- criar `apps/web/src/components/TvDeviceApprovalScreen.tsx` e teste;
- ajustar `apps/web/src/App.tsx`/roteamento;
- ajustar `apps/web/src/useAuth.ts` apenas se for necessário preservar explicitamente a intenção de retorno após login.

Fluxo:

- `/tv-login#token` é reconhecido antes da aplicação autenticada normal;
- token é capturado e retirado da URL imediatamente;
- se não autenticado, a tela normal de login aparece no celular sem perder o token em memória/session storage efêmero;
- após login, retorna automaticamente à confirmação enquanto o pedido for válido;
- autenticado vê `displayCode`, **Autorizar** e **Recusar**;
- sucesso não navega para player nem cria áudio;
- erro/expiração permitem fechar/voltar com mensagem simples.

Não persistir approval token em localStorage. Se for necessário sobreviver a reload durante o login, usar armazenamento efêmero com cleanup e teste explícito; preferir manter em memória quando o fluxo atual permitir.

## Task 8 — E2E com TV + celular

**Arquivos:**

- criar `e2e/tests/tv-device-login.spec.ts`;
- atualizar `.github/workflows/ci.yml` somente se o novo E2E precisar de gate explícito fora da suíte já executada.

Usar dois browser contexts isolados:

- context TV abre `/?tv=1` sem autenticação;
- captura a solicitação/URL apresentada pela UI;
- context celular abre a aprovação;
- cenário com celular já autenticado;
- cenário com celular inicialmente deslogado e retorno pós-login;
- verificar mesmo `displayCode` nas duas superfícies;
- aprovar e aguardar TV entrar na aplicação;
- provar cookies diferentes;
- provar logout/revogação independente;
- provar expiração/regeneração;
- provar que replay não cria outra sessão;
- provar fallback de senha ainda funciona.

O E2E não precisa decodificar câmera física; pode navegar para a URL que o QR representa. Leitura real do QR continua no QA de hardware.

## Task 9 — documentação final e QA físico

Após os dois PRs:

- atualizar a spec com decisões que mudarem durante implementação;
- marcar tarefas concluídas neste plano;
- registrar números dos PRs e estado final;
- validar BTV real + iPhone conforme checklist da spec;
- registrar claramente o que foi comprovado por CI e o que foi comprovado fisicamente.

## Divisão esperada de PRs

### PR 1 — `feat(auth): add TV device login protocol`

Somente backend/protocolo/segurança/testes. Deve ser revisável sem depender de UX pronta.

### PR 2 — `feat(tv): sign in with phone`

Frontend TV + celular + E2E + ajustes finais de documentação. APK novo só é necessário se houver alteração Android; com o desenho atual, `?tv=1` já é fornecido pelo wrapper e a mudança tende a ser web/server.

## Gates de conclusão

O recurso só é considerado entregue quando o HEAD final possuir CI verde no mesmo commit e a homologação física confirmar:

```text
TV gera QR
Safari abre aprovação
celular autenticado autoriza
celular deslogado autentica e retorna à aprovação
código curto coincide
TV recebe sessão própria
refresh/reabertura mantém sessão
logout da TV não desloga celular
expiração/regeneração funcionam
fallback por usuário/senha continua funcional
```

O fluxo offline LAN não faz parte deste gate; ele deve permanecer uma regressão separada e não pode passar a depender do device login online.
