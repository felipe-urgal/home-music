# E2E

Baseline de navegador do Home Music com Playwright.

Os testes usam o build real de produção, mas não usam o `.env`, a biblioteca nem o SQLite reais. O runner cria uma biblioteca e um banco temporários em `/tmp`, gera uma faixa WAV de teste e sobe o Fastify somente em `127.0.0.1:8791` durante a execução.

## Primeira instalação local

Na raiz do repositório:

```bash
npm run e2e:install
```

Isso instala as dependências isoladas de `e2e/`, o Chromium e as dependências de sistema exigidas pelo navegador.

O projeto fixa uma versão do Playwright com suporte oficial ao Ubuntu 26.04. Quando a versão do Playwright mudar, execute `npm run e2e:install` novamente para baixar o binário de navegador correspondente.

## Executar

```bash
npm run e2e
```

O comando faz o build de produção antes de executar o baseline em duas configurações:

- `mobile-chromium`: viewport 390×844 com touch/mobile emulado;
- `desktop-chromium`: viewport 1440×900.

Para executar somente os testes quando o build já existe:

```bash
npm run e2e:ci
```

O CI também audita o lockfile de `e2e/`, instala o Chromium com as dependências do sistema e executa os testes antes do smoke de produção.

Artefatos locais de falha (`playwright-report/` e `test-results/`) são ignorados pelo Git.
