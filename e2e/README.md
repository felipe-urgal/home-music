# E2E

Baseline de navegador do Home Music com Playwright.

Os testes usam o build real de produção, mas não usam `.env`, biblioteca nem SQLite reais. O runner cria biblioteca/banco temporários, gera fixtures controladas e sobe o Fastify somente em loopback durante a execução.

## Instalação

Na raiz do repositório:

```bash
npm run test:e2e:install
```

Isso instala as dependências isoladas de `e2e/`, Chromium e dependências de sistema. Execute novamente quando a versão fixada do Playwright mudar.

## Executar a suíte completa

```bash
npm run test:e2e
```

O comando faz o build e executa a regressão completa nas configurações mobile, tablet e desktop.

Quando o build já existe e você precisa trabalhar diretamente no workspace E2E:

```bash
npm --prefix e2e test
```

Para executar somente o conjunto crítico definido pelo workspace:

```bash
npm --prefix e2e run test:critical
```

Esses comandos internos não são aliases públicos do `package.json` raiz; o nome canônico da suíte completa é `test:e2e`.

## Quando E2E é necessário

E2E não é custo fixo de todo PR. Use quando a mudança depender da integração real entre browser, Fastify, persistência e build, especialmente em:

- login/sessão e isolamento entre contas;
- biblioteca/player e navegação responsiva;
- Administração e operações críticas;
- downloads/coleções offline;
- importação/origens externas com fixtures controladas;
- mudanças fullstack cuja regressão não seja bem protegida por unidade/componente.

O CI normal executa `npm run check`; Playwright entra de forma direcionada conforme o risco. A política completa está em [`../docs/testing-and-quality.md`](../docs/testing-and-quality.md).

## Benchmark browser-real de biblioteca grande

O benchmark Playwright de biblioteca grande é separado da regressão funcional:

```bash
npm run benchmark:large-library:browser
```

O padrão mede 10k e 25k faixas em desktop Chromium. Exemplos de execução manual:

```bash
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=10000 HOME_MUSIC_BROWSER_BENCHMARK_RUNS=3 npm run benchmark:large-library:browser
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=50000 npm run benchmark:large-library:browser
```

O runner semeia um snapshot determinístico pela API real de persistência; não cria milhares de arquivos de áudio. Budgets e baseline ficam em [`../docs/large-library-benchmark.md`](../docs/large-library-benchmark.md).

## Cobertura funcional

A suíte completa inclui, entre outros fluxos:

- biblioteca/player em mobile, tablet e desktop;
- fila e persistência de estado;
- playlists manuais e compartilhadas;
- downloads offline, coleções deduplicadas e isolamento entre contas;
- Minha conta, sessões e troca de senha;
- Administração, metadata, integridade, usuários, lixeira e cache;
- importação por upload, URL/provider e descoberta Jamendo com fixtures controladas.

Dependências externas não determinísticas são interceptadas quando apropriado. SSRF, staging, processo externo, validação de mídia e promoção física permanecem protegidos pelos testes de servidor responsáveis por essas invariantes.

## Isolamento e determinismo

- nenhum teste depende da biblioteca, SQLite ou internet do usuário;
- o servidor E2E usa diretório temporário descartável e loopback;
- specs que dependem de estado persistente estabelecem explicitamente o próprio estado inicial ou identificadores únicos;
- seletores novos preferem roles, labels e `data-testid`;
- não use sleeps arbitrários para sincronizar persistência assíncrona; prefira sinais da UI, respostas HTTP ou `expect.poll` sobre o estado canônico.

Artefatos locais de falha (`playwright-report/` e `test-results/`) são ignorados pelo Git.
