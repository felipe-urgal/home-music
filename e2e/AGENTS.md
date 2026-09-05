# AGENTS.md — E2E (`e2e`)

Estas regras complementam o `AGENTS.md` da raiz para mudanças em `e2e`.

Leia também `e2e/README.md` e `docs/testing-and-quality.md`.

## Papel da suíte

Playwright protege comportamento que depende da integração real entre browser, build, Fastify e persistência. Ele não substitui testes unitários/servidor para invariantes internas de segurança ou filesystem.

Use E2E principalmente quando a mudança envolver:

- login/sessão e isolamento entre contas;
- biblioteca/player/navegação em browser real;
- responsividade crítica;
- Administração e operações críticas visíveis ao usuário;
- PWA/offline/downloads/coleções;
- integração fullstack que unidade/componente não proteja adequadamente.

SSRF, confinement, symlink, processo externo, rollback de SQLite e outras garantias internas continuam pertencendo prioritariamente aos testes de servidor responsáveis pela primitive/regra.

## Isolamento

A suíte usa build real de produção, mas ambiente descartável:

- Fastify somente em loopback;
- biblioteca temporária;
- SQLite temporário;
- fixtures controladas;
- nenhum segredo real;
- nenhuma biblioteca de produção;
- nenhuma dependência de internet pública não determinística.

Specs que precisam de estado persistente devem criar/identificar explicitamente o próprio estado. Não dependa da ordem de execução de outro teste.

## Determinismo

- não use `sleep` arbitrário para “dar tempo” ao sistema;
- sincronize por UI observável, resposta HTTP, evento esperado ou `expect.poll` sobre estado canônico;
- não aumente timeout apenas para esconder race reproduzível;
- dependências externas devem ser interceptadas ou substituídas por fixture/local server quando apropriado;
- IDs, nomes e dados de teste precisam evitar colisões entre specs/workers;
- cleanup deve deixar o runner descartável mesmo quando a spec falha.

Quando um teste falhar, determine primeiro se a falha é do produto, da arquitetura responsiva ou do teste. Não altere produção para satisfazer uma expectativa incorreta do E2E.

## Seletores e acessibilidade

Prefira, nesta ordem conforme fizer sentido:

1. roles e nomes acessíveis;
2. labels/texto estável que faça parte do contrato do usuário;
3. `data-testid` quando não houver seletor semântico estável.

Evite acoplamento a classes CSS, hierarquia incidental de DOM ou posição fixa de elementos quando isso não for parte do comportamento.

Mudanças de UI devem respeitar a superfície real de cada viewport. Desktop pode usar navegação diferente de mobile/tablet; teste o contrato correto em vez de exigir o mesmo markup em todos os breakpoints.

## PWA/offline

Para specs offline, preserve:

- namespace/isolamento por usuário;
- distinção entre bytes físicos e referências lógicas;
- cleanup somente quando a última referência desaparecer;
- comportamento de reload/retomada apenas dentro das garantias realmente suportadas;
- fallback de navegadores sem Background Fetch;
- ausência de dependência de hardware real na suíte automatizada.

Validação física de plataforma/dispositivo deve ser registrada como manual somente quando realmente executada.

## Execução

Na raiz:

```bash
npm run test:e2e:install
npm run test:e2e
```

Quando o build já existe e a investigação é focada:

```bash
npm --prefix e2e test -- <spec-ou-filtro>
```

O workspace também possui `test:critical`, mas ele é um conjunto interno direcionado; o comando público da regressão completa continua sendo `npm run test:e2e`.

Benchmark browser-real é separado da regressão funcional:

```bash
npm run benchmark:large-library:browser
```

Não transforme E2E completo em custo fixo de todo PR. Execute a suíte/spec que protege o risco material da mudança e registre exatamente o que rodou.
