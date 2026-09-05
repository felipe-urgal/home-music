# AGENTS.md — regras globais do Home Music

Este arquivo define as regras globais para agentes de IA e automações que alteram este repositório. Regras específicas ficam próximas do código em arquivos `AGENTS.md` locais.

> Regra principal: **nenhuma tarefa está pronta sem revisão completa do diff no head final**. Se qualquer arquivo mudar depois da revisão, reexecute os gates afetados e repita a revisão.

## Como estas instruções se aplicam

O `AGENTS.md` da raiz vale para todo o repositório. Existem instruções complementares em:

- `apps/web/AGENTS.md` — frontend, UX, PWA/offline e clientes HTTP;
- `apps/server/AGENTS.md` — Fastify, autenticação, SQLite, filesystem, mídia e importação;
- `packages/shared/AGENTS.md` — contratos compartilhados frontend/backend;
- `e2e/AGENTS.md` — Playwright e fixtures browser-real;
- `scripts/AGENTS.md` — systemd, Tailscale, smoke/policy e automação operacional.

Leia o arquivo mais próximo do código alterado. Regras locais podem especializar o fluxo, mas **não podem enfraquecer** as regras globais de segurança, produção, revisão final ou autorização de merge.

Não duplique aqui runbooks que já têm fonte canônica. Prefira links para a documentação viva.

## Fontes de verdade

Quando houver divergência, use esta ordem:

1. comportamento executável atual: código, testes, `package.json`, workflows e exemplos de ambiente;
2. documentação corrente: `README.md`, `docs/DEVELOPMENT.md`, `docs/PRODUCTION.md`, `docs/architecture.md` e documentos funcionais do domínio;
3. `docs/roadmap.md` e issues abertas para estado de backlog/entrega;
4. ADRs, PRs antigos e documentos `phase-*` como histórico e contexto.

PR aberto descreve trabalho **ainda não mergeado**. Não trate seu comportamento futuro como estado da `main` sem necessidade explícita da tarefa.

Se código/testes e documentação corrente discordarem, confirme a implementação real e corrija a documentação na mesma entrega quando a divergência estiver dentro do escopo.

## Antes de alterar código

1. Leia a issue/tarefa e o PR relacionado, quando existir.
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

Não transforme uma tarefa pequena em auditoria geral do produto. Investigue o suficiente para corrigir a causa raiz e preservar as invariantes do fluxo afetado. Achados relevantes fora do escopo devem ser relatados separadamente, não corrigidos silenciosamente no mesmo PR.

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

Ele representa a baseline compartilhada por desenvolvimento e CI: typecheck, testes funcionais e build. Para mudanças de código/configuração/build, execute-o antes do PR quando o ambiente permitir.

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

Mudança exclusivamente documental não exige subir `npm run dev` só para cumprir ritual. Faça validação estática/coerência dos documentos e registre com precisão o que foi ou não executado; o CI do PR continua sendo evidência independente do head publicado.

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

- parta da `main` atual, salvo base explicitamente diferente;
- use branch curta e objetiva;
- antes de criar branch, confira se já existe PR cobrindo o mesmo fluxo;
- não mova trabalho para PR não relacionado apenas para evitar abrir outro;
- quando o usuário ampliar explicitamente um PR existente, atualize o escopo e repita os gates/review no novo head;
- não faça merge sem autorização explícita do usuário.

O PR deve registrar, conforme aplicável:

- escopo e decisão principal;
- riscos/invariantes conferidos;
- testes/checks realmente executados e os que não foram executados;
- documentação atualizada;
- SHA do head submetido ao review final;
- findings corrigidos e ausência de `BLOCKER`/`HIGH`/`MEDIUM` conhecido.

## Auto code review final

Depois da última alteração e dos gates aplicáveis, revise o diff completo contra a base como reviewer independente.

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

Se encontrar um problema, corrija, reexecute os gates afetados e repita o review no novo head. Review de um SHA antigo não vale como gate final depois de nova alteração.

## Definition of Done

Uma entrega está pronta quando:

- o escopo pedido está implementado sem mudança lateral desnecessária;
- contratos e invariantes das camadas afetadas foram preservados;
- testes focados relevantes existem/passam quando necessários;
- gates proporcionais ao risco foram executados ou a limitação foi registrada honestamente;
- documentação viva foi atualizada quando necessário;
- o diff final foi revisado sem finding bloqueante conhecido;
- o PR descreve o estado real, sem afirmar validações não executadas.

## Referências canônicas

- `README.md` — visão geral e entrada do projeto;
- `docs/DEVELOPMENT.md` — setup e fluxo diário de desenvolvimento;
- `docs/PRODUCTION.md` — operação da instalação real;
- `docs/architecture.md` — arquitetura corrente;
- `docs/testing-and-quality.md` — política de gates;
- `docs/README.md` — índice de documentação e backlog corrente;
- documentos funcionais do domínio alterado — invariantes específicas.
