# Desenvolvimento

Este é o ponto de entrada canônico para desenvolver e validar o Home Music.

## Preparação local

O ambiente de desenvolvimento é isolado da instalação systemd de produção. Ele usa `.env.development`, API na porta `8788`, SQLite/cache em `data/development/` e uma biblioteca descartável em `music-dev/`.

```bash
npm ci
cp .env.development.example .env.development
mkdir -p music-dev data/development
```

Antes do primeiro start, configure em `.env.development` uma senha temporária DEV com pelo menos 12 caracteres. Não reutilize a biblioteca, SQLite ou credenciais de produção.

Detalhes do isolamento: [`development-environments.md`](development-environments.md).

## Executar

```bash
npm run dev
```

Endereços padrão:

```text
Web: http://localhost:5173
API: http://127.0.0.1:8788
```

Valide manualmente o fluxo alterado no ambiente DEV antes de considerar a implementação concluída.

## Baseline antes do PR

O gate local normal é:

```bash
npm run check
```

Ele executa, na ordem:

```text
typecheck
-> testes funcionais
-> build
```

Esse baseline também é o primeiro gate do CI, mas o workflow obrigatório executa validações adicionais. Para reproduzir o estado atual do CI, consulte [`testing-and-quality.md`](testing-and-quality.md) e `.github/workflows/ci.yml`.

## Checks direcionados

Além dos gates já promovidos ao CI, use conforme o risco da mudança:

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

- `test:security`: fronteiras sensíveis de autenticação, administração e importação; atualmente também faz parte do CI obrigatório;
- `test:policy`: Dependabot e lifecycle/dependency policies; também roda no audit semanal/manual;
- `test:ops`: contratos shell de systemd e Tailscale, sem instalar/reiniciar produção;
- `test:e2e`: suíte completa de fluxos em navegador real; o CI mantém apenas um E2E focado de importação pessoal como gate fixo;
- benchmarks: mudanças com risco de escala/performance;
- `smoke:production`: mudanças em build de produção, serviço ou operação;
- `smoke:backup-restore`: mudanças de SQLite/backup/restore; atualmente também faz parte do CI obrigatório.

Instale o navegador E2E na primeira execução ou quando a versão do Playwright mudar:

```bash
npm run test:e2e:install
```

A política completa está em [`testing-and-quality.md`](testing-and-quality.md).

## Fluxo recomendado

```text
issue
-> branch curta
-> implementação + testes focados
-> npm run dev
-> validação manual
-> npm run check
-> checks direcionados quando o risco justificar
-> PR
-> CI
-> auto-review no SHA final
-> merge
```

Mudanças em comportamento, operação ou arquitetura atualizam a documentação correspondente no mesmo PR.

## Depois do merge

O merge por si só não atualiza a instalação systemd. Para operação real, siga [`PRODUCTION.md`](PRODUCTION.md).
