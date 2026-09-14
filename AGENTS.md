# AGENTS.md — regras globais do Home Music

Este arquivo define as regras globais e duráveis para agentes de IA e automações que alteram este repositório. Regras específicas ficam próximas do código em arquivos `AGENTS.md` locais.

> Regra principal: **nenhuma mudança está pronta para merge sem revisão completa do diff no head final e sem os gates obrigatórios aplicáveis ao mesmo head**. Se qualquer arquivo mudar depois da revisão ou da validação, reavalie os gates afetados e repita a revisão necessária.

## Como estas instruções se aplicam

O `AGENTS.md` da raiz vale para todo o repositório. Existem instruções complementares em:

- `apps/web/AGENTS.md` — frontend, UX, PWA/offline e clientes HTTP;
- `apps/server/AGENTS.md` — Fastify, autenticação, SQLite, filesystem, mídia e importação;
- `packages/shared/AGENTS.md` — contratos compartilhados frontend/backend;
- `e2e/AGENTS.md` — Playwright e fixtures browser-real;
- `scripts/AGENTS.md` — systemd, Tailscale, smoke/policy e automação operacional;
- `agent-orchestrator/agents/` — overlays locais por papel para execuções coordenadas pelo `agent-orchestrator`;
- `agent-workflow-browser/agents/` — overlays locais por papel para execuções coordenadas pelo `agent-workflow-browser`.

Leia o arquivo mais próximo do código alterado. Regras locais podem especializar o fluxo, mas não podem enfraquecer invariantes globais de segurança, dados, produção, validação ou autorização.

Quando a execução vier de um dos workflows externos acima, leia também o arquivo de overlay cujo identificador corresponde ao papel atual, quando existir. Esses overlays contêm somente contexto específico do Home Music; contrato, state machine, handoff e autorizações do workflow continuam definidos no projeto externo responsável pela execução.

Não duplique aqui runbooks que já têm fonte canônica. Prefira links para a documentação viva.

## Fontes de verdade do projeto

Quando uma task externa for fornecida por um workflow de automação, use-a para objetivo, escopo e decisões específicas já aprovadas para a entrega. O repositório continua sendo a fonte para verificar implementação, arquitetura, invariantes e comportamento técnico atual.

Para o estado técnico/local, considere:

1. comportamento executável atual: código, testes, `package.json`, workflows e exemplos de ambiente;
2. documentação corrente: `README.md`, `docs/DEVELOPMENT.md`, `docs/PRODUCTION.md`, `docs/architecture.md` e documentos funcionais do domínio;
3. `docs/roadmap.md` e issues abertas para backlog e planejamento do produto;
4. ADRs, PRs antigos e documentos `phase-*` como histórico e contexto.

PR aberto descreve trabalho **ainda não mergeado**. Não trate seu comportamento futuro como estado da `main` sem necessidade explícita da tarefa.

Se código/testes e documentação corrente discordarem, confirme a implementação real e corrija a documentação na mesma entrega quando a divergência estiver dentro do escopo.

## Antes de alterar código

1. Leia a task/issue e o PR relacionado, quando existir.
2. Confira a `main` atual e PRs abertos para evitar trabalho paralelo ou conflito desnecessário.
3. Leia o `AGENTS.md` local aplicável.
4. Leia somente os documentos e testes necessários para entender o domínio alterado.
5. Trace o fluxo ponta a ponta relevante quando a mudança atravessar camadas.

Caminho fullstack típico:

```text
UI
-> client/hook
-> contrato compartilhado
-> rota Fastify
-> serviço/store/manager
-> SQLite / filesystem / processo externo
-> resposta
-> estado exibido
```

Não transforme uma tarefa pequena em auditoria geral do produto. Investigue o suficiente para corrigir a causa raiz e preservar as invariantes do fluxo afetado. Achados relevantes fora do escopo devem ser registrados separadamente, não corrigidos silenciosamente no mesmo PR.

## Princípios de engenharia

- corrija a causa raiz, não masque o sintoma;
- mantenha uma única fonte de verdade por estado ou regra;
- prefira mudanças pequenas, explícitas e reversíveis;
- preserve contratos existentes salvo mudança intencional e documentada;
- não introduza dependência nova sem necessidade concreta;
- não use `any`, assertions frouxas ou bypasses para contornar modelagem/testes quando há solução tipada;
- não enfraqueça autenticação, autorização, validação, tipos ou testes para deixar CI verde;
- não altere comportamento fora do escopo sem justificar;
- remova duplicação/código morto criado pela própria mudança quando isso for seguro e local;
- documentação viva faz parte da mudança quando comportamento, arquitetura ou operação mudarem.

## Contratos fullstack

Mudança que atravessa frontend/backend deve ser analisada nos dois lados.

- contratos reais compartilhados pertencem a `packages/shared`;
- backend valida payload e autorização mesmo que o frontend já valide;
- frontend trata loading, vazio, erro, sucesso e respostas assíncronas obsoletas;
- respostas públicas não expõem paths físicos, stack traces, cookies, tokens, hashes ou segredos;
- mudanças de formato consideram compatibilidade com clientes e dados existentes;
- não crie uma segunda fonte de verdade apenas para facilitar uma tela ou endpoint.

## Invariantes globais de segurança e dados

Estas regras valem independentemente da pasta alterada:

- o backend é a fronteira real de autenticação e autorização;
- ownership pessoal deriva da sessão/credencial autenticada, nunca de `userId` arbitrário enviado pelo cliente;
- `/api/admin/*` permanece restrito a `admin` pela política central;
- mutações autenticadas da aplicação preservam `X-Home-Music-Request: 1` quando o contrato atual exigir;
- senhas, hashes completos, cookies, tokens e segredos nunca são logados ou versionados;
- `MUSIC_DIR` é a fronteira física da biblioteca; paths do cliente nunca viram autoridade de filesystem;
- operações físicas preservam confinement, validação de arquivo regular, proteção contra symlink/traversal, no-clobber, locks e rollback aplicáveis;
- importação promove conteúdo somente depois de staging/scratch e validação; provider externo não escreve diretamente em `MUSIC_DIR`;
- SQLite/migrations preservam dados existentes, `PRAGMA user_version`, transações e rollback;
- ações destrutivas são explícitas e preferem fluxo reversível/quarentena quando disponível;
- processos externos usam programa + argumentos, sem shell livre, com timeout/limites/cleanup adequados;
- retry é nova tentativa controlada, não reaproveitamento silencioso de estado intermediário inconsistente.

Detalhes específicos estão em `apps/server/AGENTS.md` e na documentação funcional correspondente.

## Validação proporcional ao risco

O gate normal do repositório é:

```bash
npm run check
```

Ele representa a baseline compartilhada por desenvolvimento e CI: typecheck, testes funcionais e build. Para mudanças de código/configuração/build, execute-o localmente quando o modo permitir ou observe a execução equivalente no CI do head correto.

Checks adicionais entram pelo risco da mudança, não por ritual:

| Risco alterado | Validação adicional típica |
| --- | --- |
| auth, autorização, administração ou importação sensível | `npm run test:security` |
| scripts systemd/Tailscale ou política operacional | `npm run test:ops` |
| política de dependências/lifecycle | `npm run test:policy` |
| integração browser/fullstack crítica | `npm run test:e2e` ou spec focada no workspace E2E |
| escala/performance | benchmark correspondente |
| build/serviço/backup/restore de produção | smoke correspondente |

Política detalhada: `docs/testing-and-quality.md`.

Mudança exclusivamente documental não exige subir `npm run dev` só para cumprir ritual. Faça validação estática/coerência dos documentos e registre com precisão o que foi ou não executado; o CI do PR, quando existir, é evidência independente do head publicado.

Validação manual é necessária quando existe comportamento observável que os testes não cobrem adequadamente. Não declare teste manual, hardware, serviço externo ou operação real como executado sem evidência.

## Produção e operações reais

DEV e produção são isolados. O fluxo diário de desenvolvimento está em `docs/DEVELOPMENT.md`; operação real está em `docs/PRODUCTION.md`.

Sem solicitação explícita do usuário para operar a instalação real, **não execute** ações que mutem:

- systemd/serviço real;
- `.env` de produção;
- SQLite real ou restore;
- `MUSIC_DIR` real;
- perfil Tailscale Serve/Funnel;
- helper privilegiado ou configuração do host.

Isso inclui `prod:deploy`, `service:install`, `service:update`, `backup:restore`, comandos `tailscale:*:enable/disable` e mutações equivalentes. Não use produção apenas como ambiente de teste de um PR.

Comandos read-only de produção também só devem ser usados quando forem pertinentes à tarefa operacional solicitada.

## Git e PR

Regras locais:

- parta da `main` atual, salvo base explicitamente diferente;
- use branch curta e objetiva;
- antes de criar branch, confira se já existe PR cobrindo o mesmo fluxo;
- não mova trabalho para PR não relacionado apenas para evitar abrir outro;
- quando o usuário ampliar explicitamente um PR existente, atualize o escopo e repita os gates/review no novo head;
- não execute push, commits remotos, abertura/atualização de PR, merge, delete remoto, deploy ou release sem a autorização aplicável ao fluxo atual;
- merge continua exigindo autorização explícita mesmo com CI verde.

O PR deve registrar, conforme aplicável:

- escopo e decisão principal;
- riscos/invariantes conferidos;
- testes/checks realmente executados e os que não foram executados;
- documentação atualizada;
- SHA do head submetido ao review final;
- findings corrigidos e bloqueios conhecidos.

## Revisão final do diff

A revisão independente não substitui a necessidade de o head entregue permanecer coerente com o que foi validado. Depois da última alteração e dos gates aplicáveis, o diff completo contra a base deve ser revisado no head correspondente.

Confira no mínimo:

- escopo e comportamento esperado;
- edge cases, erros e falhas parciais;
- concorrência, stale async, locks e cleanup quando aplicável;
- autenticação/autorização, SSRF, traversal, symlink e command injection nas superfícies relevantes;
- migrations, transações e compatibilidade de dados;
- responsividade/acessibilidade quando houver UI;
- código morto, duplicação e fontes paralelas de verdade;
- documentação coerente com código, scripts e workflows;
- nenhum segredo ou nova autoridade indevida introduzida.

Se o SHA mudar depois de review/CI, reavalie o que foi invalidado pela mudança antes de declarar readiness de merge.

## Definição de pronto

Para uma mudança estar **pronta para merge** no Home Music:

- o escopo pedido está implementado sem mudança lateral desnecessária;
- contratos e invariantes das camadas afetadas foram preservados;
- testes focados relevantes existem/passam quando necessários;
- `npm run check` e gates adicionais obrigatórios ao risco passaram no head final por execução local ou CI equivalente realmente observado;
- validação manual material foi concluída quando os testes não cobrem adequadamente o comportamento observável;
- documentação viva foi atualizada quando necessário;
- o diff final foi revisado no head correspondente;
- não existem findings bloqueantes conhecidos;
- o PR descreve o estado real sem afirmar validações não executadas;
- merge só ocorre após autorização explícita do usuário.

## Referências canônicas

- `README.md` — visão geral e entrada do projeto;
- `docs/DEVELOPMENT.md` — setup e fluxo diário de desenvolvimento;
- `docs/PRODUCTION.md` — operação da instalação real;
- `docs/architecture.md` — arquitetura corrente;
- `docs/testing-and-quality.md` — política de gates;
- `docs/README.md` — índice de documentação e backlog corrente;
- documentos funcionais do domínio alterado — invariantes específicas.
