# E2E

Baseline de navegador do Home Music com Playwright.

Os testes usam o build real de produção, mas não usam o `.env`, a biblioteca nem o SQLite reais. O runner cria uma biblioteca e um banco temporários em `/tmp`, gera faixas WAV de teste, prepara uma playlist Rekordbox controlada e sobe o Fastify somente em `127.0.0.1:8791` durante a execução.

## Primeira instalação local

Na raiz do repositório:

```bash
npm run e2e:install
```

Isso instala as dependências isoladas de `e2e/`, o Chromium e as dependências de sistema exigidas pelo navegador.

O projeto fixa uma versão do Playwright com suporte ao ambiente alvo da suíte. Quando a versão do Playwright mudar, execute `npm run e2e:install` novamente para baixar o binário de navegador correspondente.

## Executar

Para executar a regressão E2E completa, incluindo build de produção:

```bash
npm run e2e
```

A suíte completa roda nas três configurações:

- `mobile-chromium`: viewport 390×844 com touch/mobile emulado;
- `tablet-chromium`: viewport 834×1112 com touch;
- `desktop-chromium`: viewport 1440×900.

Quando o build já existe, execute a regressão completa diretamente:

```bash
npm run e2e:ci
```

Para reproduzir localmente somente o gate obrigatório do CI:

```bash
npm --prefix e2e run test:critical
```

## Benchmark browser-real de biblioteca grande

A issue #237 adiciona um runner Playwright separado da regressão funcional normal. Ele mede uma biblioteca sintética grande no **desktop Chromium** usando o build real servido pelo Fastify.

Depois de `npm run build` e da instalação do Chromium, execute:

```bash
npm run benchmark:large-library:browser
```

O padrão roda sequencialmente 10k e 25k faixas. Para amostrar estabilidade ou executar um perfil manual diferente:

```bash
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=10000 HOME_MUSIC_BROWSER_BENCHMARK_RUNS=3 npm run benchmark:large-library:browser
HOME_MUSIC_BROWSER_BENCHMARK_TRACKS=50000 npm run benchmark:large-library:browser
```

O runner grande não cria 10k/25k arquivos de áudio. O `start-server.mjs` semeia um snapshot determinístico pela API real `HomeMusicDatabase.syncTracks`, de forma que o teste continue atravessando SQLite, `LibraryService`, `/api/library`, Fastify, build de produção e React/Chromium sem introduzir o custo variável do scanner físico. O scanner continua coberto pelo benchmark rápido do servidor.

O relatório JSON inclui tempo até a biblioteca ficar utilizável, bytes do `/api/library`, bundle inicial, long tasks, busca/filtro/ordenação, crescimento da lista, heap/RSS do servidor e heap JS do browser quando disponível. Os budgets e a baseline ficam documentados em `docs/large-library-benchmark.md`.

## Gate obrigatório no CI

O workflow principal do GitHub Actions usa o mesmo job `validate` para manter um único status obrigatório. Depois dos gates mais baratos e do build, ele:

1. instala somente o Chromium compatível com a versão fixada de `@playwright/test`, usando `playwright install --with-deps chromium`;
2. executa `npm run benchmark:large-library:browser` para o guard de 10k/25k;
3. executa `npm --prefix e2e run test:critical`;
4. só então executa o smoke de produção.

O gate funcional continua deliberadamente focado, mas inclui as regressões cuja quebra teria impacto direto nos fluxos críticos atuais:

- `critical-smoke.spec.ts` — login, shell autenticado, biblioteca, Minha conta e Administração em mobile/tablet/desktop;
- `offline-collections-critical.spec.ts` — playlist offline deduplicada, promoção para referência individual sem novo blob, snapshot desatualizado, atualização, garbage-collection por referência e controle mobile;
- `desktop-offline-downloads.spec.ts` — download individual e seleção em lote no desktop;
- `offline-account-isolation.spec.ts` — isolamento de CacheStorage e do manifesto lógico de referências entre contas no mesmo navegador.

A ampliação do gate offline acompanha a #174 porque essa entrega altera o modelo de ownership local dos artefatos. Ela não transforma toda a regressão E2E em gate obrigatório.

A suíte completa continua necessária quando o risco exigir. Fluxos mais caros e específicos — fila persistente, smart playlists, disponibilidade de faixas, importação e operações administrativas — permanecem disponíveis fora do conjunto crítico.

Uma falha no conjunto crítico ou no benchmark browser-real falha o mesmo job que governa o merge. O job possui timeout explícito de 30 minutos para o conjunto inteiro de validações, não para o Playwright isoladamente.

O cache npm do Actions considera `package-lock.json` e `e2e/package-lock.json`. O binário do navegador não possui cache manual próprio: reinstalar o Chromium correspondente ao lockfile evita reutilizar browser/dependências de sistema incompatíveis. Se o custo desse passo se tornar relevante, qualquer cache futuro deve ser versionado por sistema operacional e pelo lock/versão do Playwright, sem pular a instalação das dependências de sistema necessárias.

A partir da #111, um PR só pode declarar o gate E2E verde quando os steps de browser obrigatórios tiverem realmente executado no HEAD final.

## Cobertura da suíte completa

A suíte combina fluxo real contra o Fastify temporário e fixtures de navegador apenas quando a dependência externa tornaria o teste não determinístico.

Cobertura principal:

- biblioteca/player nos layouts mobile, tablet e desktop;
- fila desktop com reordenação e persistência real do estado após reload;
- playlists manuais pessoais e playlist Rekordbox compartilhada/read-only;
- downloads offline individuais/em lote, coleções offline deduplicadas e isolamento de cache/referências na troca de conta;
- Minha conta, sessões, troca obrigatória de senha e isolamento multiusuário;
- Administração: cockpit, músicas, metadata, integridade, usuários, lixeira, cache, histórico e normalização lógica;
- importação por upload, URL direta e provider, além do workbench validação → metadata → duplicatas → destino/promoção com fixtures controladas.

As rotas de URL/provider são interceptadas somente nos testes de orquestração de UI para não depender de internet pública. SSRF, staging, processos externos, validação de mídia e promoção física permanecem cobertos pelos testes de servidor responsáveis por essas invariantes.

## Isolamento e determinismo

- nenhum teste deve depender da biblioteca, SQLite ou internet do usuário;
- o servidor E2E usa um diretório temporário descartável e loopback;
- a playlist Rekordbox da fixture é criada pela própria API de persistência `HomeMusicDatabase.syncImportedPlaylists`, sem SQL duplicado nem XML real;
- o modo de benchmark grande usa `HomeMusicDatabase.syncTracks` e nunca toca a biblioteca real;
- o servidor temporário é compartilhado durante uma execução completa da suíte, portanto specs que dependam de estado persistente devem estabelecer explicitamente o próprio estado inicial ou usar identificadores únicos;
- seletores novos devem preferir roles, labels e `data-testid`; CSS estrutural só deve ser usado quando não houver contrato acessível equivalente;
- não use sleeps arbitrários para sincronizar persistência assíncrona; prefira sinais da UI, respostas HTTP ou `expect.poll` sobre o estado canônico.

Artefatos locais de falha (`playwright-report/` e `test-results/`) são ignorados pelo Git.