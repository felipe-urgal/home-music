# E2E

Baseline de navegador do Home Music com Playwright.

Os testes usam o build real de produção, mas não usam `.env`, biblioteca nem SQLite reais. O runner cria biblioteca, banco e arquivo de ambiente temporários, aponta o preload de produção para esse env descartável e sobe o Fastify somente em loopback. O `.env` real da raiz nunca é lido nem alterado.

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

Quando o build já existe:

```bash
npm --prefix e2e test
```

Para o conjunto crítico do workspace:

```bash
npm --prefix e2e run test:critical
```

Esses comandos internos não substituem o nome canônico da suíte completa na raiz: `test:e2e`.

## E2Es fixos do CI

O workflow principal promoveu alguns cenários direcionados a gates obrigatórios. Atualmente executa:

- `tests/crossfade-mobile.spec.ts --project=mobile-chromium`;
- `tests/tv-remote-control.spec.ts --project=desktop-chromium`;
- `tests/personal-data-import.spec.ts`;
- `tests/admin-library-assistant.spec.ts --project=desktop-chromium` com o flag de fixture correspondente.

A lista executável continua sendo `.github/workflows/ci.yml`; este README deve acompanhar qualquer alteração nela.

### Controle remoto TV ↔ celular

`tv-remote-control.spec.ts` abre a experiência TV e um segundo context mobile autenticado na mesma conta. O cenário prova:

- abertura do pareamento e geração da URL remota;
- foco inicial, navegação por seta dentro do modal e retorno ao botão de origem via Escape;
- sessão preservada quando o overlay é apenas escondido;
- rota mobile sem `<audio>`;
- estado play/pause sincronizado entre TV e celular;
- comando de próxima faixa;
- seek +10 s.

Esse E2E não simula câmera nem decodifica o QR. A leitura física do QR permanece na homologação BTV. Também não cria uma segunda conta apenas para repetir ownership: isolamento de usuário é coberto pelos testes HTTP reais de `tv-remote-routes.test.ts`.

## Quando E2E é necessário

Use Playwright quando a mudança depender da integração real entre browser, Fastify, persistência e build, especialmente em:

- login/sessão e isolamento entre contas;
- biblioteca/player e navegação responsiva;
- Administração e operações críticas;
- downloads/coleções offline;
- importação/origens externas com fixtures controladas;
- mudanças fullstack cuja regressão não seja bem protegida por unidade/componente.

A política completa está em [`../docs/testing-and-quality.md`](../docs/testing-and-quality.md).

## Benchmark browser-real de biblioteca grande

O benchmark de biblioteca grande é separado da regressão funcional:

```bash
npm run benchmark:large-library:browser
```

O padrão mede 10k e 25k faixas em desktop Chromium. Exemplos:

```bash
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=10000 HOME_MUSIC_BROWSER_BENCHMARK_RUNS=3 npm run benchmark:large-library:browser
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=50000 npm run benchmark:large-library:browser
```

O runner semeia snapshot determinístico pela API real de persistência e não cria milhares de arquivos de áudio. Budgets ficam em [`../docs/large-library-benchmark.md`](../docs/large-library-benchmark.md).

## Cobertura funcional

A suíte completa inclui, entre outros:

- biblioteca/player em mobile, tablet e desktop;
- fila e persistência de estado;
- playlists manuais e compartilhadas;
- downloads offline, coleções deduplicadas e isolamento entre contas;
- Minha conta, sessões e troca de senha;
- Administração, metadata, integridade, usuários, lixeira e cache;
- importação por upload, URL/provider e descoberta Jamendo com fixtures controladas.

Dependências externas não determinísticas são interceptadas quando apropriado. SSRF, staging, processo externo, validação de mídia, promoção física e ownership de sessão remota permanecem protegidos pelos testes de servidor responsáveis por essas invariantes.

## Isolamento e determinismo

- nenhum teste depende da biblioteca, SQLite, `.env` raiz ou internet do usuário;
- o servidor E2E usa diretório temporário descartável e loopback;
- o env de preload vive no diretório temporário e é removido no cleanup;
- specs persistentes estabelecem explicitamente o próprio estado inicial;
- seletores novos preferem roles, labels e `data-testid`;
- não use sleeps arbitrários; prefira sinais da UI, respostas HTTP ou `expect.poll` sobre estado canônico.

Artefatos de falha (`playwright-report/` e `test-results/`) são ignorados pelo Git.
