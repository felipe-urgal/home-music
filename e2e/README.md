# E2E

Baseline de navegador do Home Music com Playwright.

Os testes usam o build real de produção, mas não usam o `.env`, a biblioteca nem o SQLite reais. O runner cria uma biblioteca e um banco temporários em `/tmp`, gera uma faixa WAV de teste e sobe o Fastify somente em `127.0.0.1:8791` durante a execução.

## Primeira instalação local

Na raiz do repositório:

```bash
npm run e2e:install
```

Isso instala as dependências isoladas de `e2e/`, o Chromium e as dependências de sistema exigidas pelo navegador.

O projeto fixa uma versão do Playwright com suporte ao ambiente alvo da suíte. Quando a versão do Playwright mudar, execute `npm run e2e:install` novamente para baixar o binário de navegador correspondente.

## Executar

```bash
npm run e2e
```

O comando faz o build de produção antes de executar a suíte em três configurações:

- `mobile-chromium`: viewport 390×844 com touch/mobile emulado;
- `tablet-chromium`: viewport 834×1112 com touch;
- `desktop-chromium`: viewport 1440×900.

Para executar somente os testes quando o build já existe:

```bash
npm run e2e:ci
```

## Relação com o CI atual

O workflow principal do GitHub Actions hoje:

- executa `npm ci --prefix e2e` para validar o lockfile/dependências da suíte;
- executa `npm audit --prefix e2e --audit-level=high`;
- **não instala o browser nem executa Playwright automaticamente** no job principal.

Portanto, um CI verde não deve ser descrito como evidência de que todos os E2E passaram. Quando uma mudança de fluxo/UX exigir esse gate, execute `npm run e2e`/`npm run e2e:ci` em ambiente com Chromium instalado ou adicione a execução ao workflow de forma explícita.

A issue #111 rastreia a expansão/consolidação da cobertura e do gate E2E para os fluxos críticos.

## Cobertura atual

A suíte já possui baseline multiusuário e cenários administrativos/fullstack específicos, incluindo biblioteca, layout desktop, downloads offline e fluxos administrativos com fixtures controladas.

Novos testes devem continuar independentes de internet pública, biblioteca real e SQLite real do usuário.

Artefatos locais de falha (`playwright-report/` e `test-results/`) são ignorados pelo Git.
