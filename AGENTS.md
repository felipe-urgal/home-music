# AGENTS.md — fluxo de desenvolvimento do Home Music

Este arquivo define como agentes de IA e colaboradores automatizados devem trabalhar neste repositório.

> Regra principal: **nenhuma tarefa está pronta sem auto code review completo no head final**. Se qualquer arquivo mudar depois do review, repita os gates afetados e o review.

## Antes de alterar código

Leia, no mínimo:

1. issue/tarefa e PR relacionado;
2. `README.md`;
3. [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md);
4. [`docs/PRODUCTION.md`](docs/PRODUCTION.md) quando houver operação/deploy/dados;
5. `docs/architecture.md`;
6. documentos e testes do domínio alterado.

Confira PRs abertos e a `main` atual antes de criar branch. Não acumule PR paralelo no mesmo fluxo sem necessidade.

Entenda o caminho ponta a ponta relevante:

```text
UI
-> client/hook
-> contrato compartilhado
-> rota Fastify
-> serviço/store
-> SQLite / filesystem / processo externo
-> resposta
-> estado exibido
```

Não trate documentação histórica `phase-*` como estado atual sem validar código/testes.

## Princípios de engenharia

- procure a causa raiz, não masque o sintoma;
- mantenha uma única fonte de verdade por estado/regra;
- prefira mudanças pequenas, explícitas e reversíveis;
- não introduza dependência nova sem necessidade clara;
- não enfraqueça segurança, tipos ou testes para deixar CI verde;
- preserve compatibilidade de dados/migrations;
- atualize documentação viva na mesma entrega;
- não faça merge com blocker/high/medium conhecido pendente.

## Desenvolvimento local

DEV é isolado da produção:

```text
Config: .env.development
Web: 5173
API: 8788
SQLite/cache: data/development/
Biblioteca recomendada: music-dev/
```

Setup:

```bash
npm ci
cp .env.development.example .env.development
mkdir -p music-dev data/development
npm run dev
```

Nunca aponte desenvolvimento para o SQLite ou `MUSIC_DIR` reais de produção. Veja [`docs/development-environments.md`](docs/development-environments.md).

## Gate normal

Antes do PR:

```bash
npm run check
```

`check` executa:

```text
typecheck
-> testes funcionais
-> build
```

O CI usa o mesmo gate. Não mantenha outra lista paralela de comandos como requisito normal.

Checks direcionados conforme risco:

```bash
npm run test:security
npm run test:policy
npm run test:ops
npm run test:e2e
npm run benchmark:large-library
npm run benchmark:large-library:browser
npm run benchmark:backpressure
npm run smoke:production
npm run smoke:backup-restore
```

E2E/benchmarks/smokes/security não são custo fixo de todo PR. Use quando protegem risco material. Política: [`docs/testing-and-quality.md`](docs/testing-and-quality.md).

## Contratos fullstack

Mudança de API é analisada nos dois lados.

- tipos compartilhados pertencem a `packages/shared` quando representam contrato real;
- backend valida payload mesmo que frontend valide;
- erros públicos são seguros e acionáveis;
- frontend trata loading/vazio/erro/sucesso e respostas obsoletas;
- não exponha paths físicos, stack traces, cookies, tokens ou segredos.

## Frontend / UX

O Home Music deve permanecer simples, ágil e funcional.

- não duplique fonte de verdade;
- descarte respostas assíncronas obsoletas;
- loading só durante trabalho real;
- ações destrutivas são explícitas e confirmadas;
- preserve mobile/tablet/desktop, teclado, foco, contraste e touch targets;
- não use cor como único feedback;
- prefira quarentena/restauração antes de delete físico permanente;
- não implemente filesystem/confinement no frontend.

## Backend, autenticação e autorização

O backend é a fronteira real de segurança.

- `/api/admin/*` exige `admin`;
- ownership pessoal deriva da sessão, não de `userId` arbitrário do cliente;
- mutações autenticadas preservam `X-Home-Music-Request: 1`;
- nunca logue senha, hash completo, cookie ou token;
- não permita remover/rebaixar o último administrador ativo;
- valide input na borda e mantenha mensagens externas sanitizadas.

## Filesystem e operações destrutivas

Revise sempre:

- traversal e paths absolutos inesperados;
- symlink escape;
- arquivos não regulares;
- colisão/no-clobber;
- corrida entre validação e uso;
- rollback/falha parcial;
- concorrência com scan/importação/outro job.

`MUSIC_DIR` é a fronteira física da biblioteca. O frontend nunca executa `rename`, `unlink` ou confinement por conta própria.

## Importação, URLs e processos externos

Pipeline esperado:

```text
origem
-> staging/scratch
-> validação
-> metadata
-> duplicatas
-> destino seguro
-> promoção
-> indexação incremental
```

Para URLs, revise SSRF, redirects, protocolos, redes privadas/reservadas, timeout, limite de bytes e Content-Type.

Para processos externos:

- prefira programa + args com `shell: false`;
- limite timeout/saída;
- cleanup da árvore de processos;
- trate saída do provider como input não confiável;
- provider nunca escreve diretamente em `MUSIC_DIR`.

Retry é nova tentativa, não reaproveitamento silencioso de staging inconsistente.

## SQLite e persistência

- migrations são ordenadas e compatíveis;
- preserve `PRAGMA user_version` e dados existentes;
- use transação para mudanças relacionadas;
- revise foreign keys, locks e falhas parciais;
- teste reopen/restore quando persistência for relevante;
- nunca apague dados só para simplificar migration.

Mudança com risco de schema/dados precisa considerar backup/restore e [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

## Produção

A produção real usa `.env`, systemd e API/readiness em `8787`.

Interface canônica:

```bash
npm run prod:status
npm run prod:check
npm run prod:backup
npm run prod:deploy
npm run prod:verify
npm run prod:logs
```

`prod:check` é `check + smoke:production`; não confunda com o gate normal do PR.

`prod:deploy` é uma mutação real via `service:update`. `service:install` é bootstrap/reconfiguração privilegiada, não etapa comum de todo deploy.

Não execute deploy, restart ou backup real apenas para validar PR.

## Testes

Priorize testes que protegem comportamento/material de risco:

- domínio e contratos HTTP;
- auth/autorização/isolamento;
- filesystem e operações destrutivas;
- SQLite/migrations/concorrência;
- importação/SSRF/processos externos;
- regressões reais;
- UX crítica.

Não adicione teste só para aumentar coverage ou congelar detalhe incidental de markup/CSS/configuração.

Falha de teste deve ser investigada; não classifique como flaky sem evidência e não afrouxe assertion correta.

## Auto code review final

Depois do último commit e dos gates aplicáveis, revise o diff completo contra a base como reviewer independente.

Confira no mínimo:

- escopo e comportamento esperado;
- edge cases e falhas parciais;
- concorrência/stale async/cleanup;
- autorização, SSRF, traversal, symlink e command injection;
- migrations/transações/backup;
- responsividade/acessibilidade quando houver UI;
- código morto/duplicação;
- documentação verdadeira;
- nenhum segredo ou autoridade nova introduzida.

Se encontrar algo, corrija, gere novo SHA, reexecute os gates afetados e repita o review.

Antes de mergear, registre no PR:

- SHA revisado;
- escopo/riscos conferidos;
- achados corrigidos;
- gates aplicáveis verdes;
- ausência de finding bloqueante.

## Fluxo de entrega

```text
issue / escopo
-> verificar main + PRs
-> branch
-> investigar
-> implementar + testes focados
-> npm run dev
-> validação manual
-> npm run check
-> checks direcionados conforme risco
-> PR
-> CI verde
-> auto-review no SHA final
-> merge autorizado
-> operação pós-merge quando aplicável
```

Merge exige autorização do usuário. Depois do merge, produção segue [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

## Documentação

Documentação faz parte do Definition of Done.

Fontes principais:

- `README.md` — entrada do projeto;
- `docs/DEVELOPMENT.md` — setup/gate/PR;
- `docs/PRODUCTION.md` — produção real;
- `docs/README.md` — índice detalhado;
- `docs/architecture.md` — arquitetura;
- `docs/testing-and-quality.md` — política de gates;
- documentos funcionais do domínio alterado.

O objetivo de cada PR é deixar o sistema mais simples de entender, mais difícil de quebrar e mais fácil de operar.
