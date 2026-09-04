# Testes e qualidade

A suíte do Home Music deve proteger comportamento e risco real, sem transformar toda validação disponível em custo fixo de cada pull request.

## Gate normal de PR

O gate canônico é:

```bash
npm run check
```

Ele executa:

```text
typecheck
-> testes funcionais
-> build
```

O CI obrigatório usa o mesmo caminho depois de `npm ci`:

```text
npm ci --no-audit --no-fund
npm run check
```

`npm test` cobre as suítes funcionais de servidor/web e o contrato executável de verificação de produção. Coverage, browser, benchmarks, security regressions e smokes não fazem parte do custo fixo de todo PR.

## Checks direcionados

Use validações adicionais quando o risco da mudança justificar:

- `npm run test:security` para autenticação, autorização, administração, importação e outras fronteiras sensíveis;
- `npm run test:policy` para políticas de Dependabot e lifecycle scripts; esse check também roda no workflow semanal/manual de audit;
- `npm run test:ops` para contratos shell de systemd e Tailscale;
- `npm run test:e2e` para fluxos críticos de usuário ou integrações fullstack que precisem de navegador real;
- `npm run benchmark:large-library` e benchmarks relacionados para mudanças com risco de regressão de escala/performance;
- `npm run smoke:production` e `npm run smoke:backup-restore` para mudanças operacionais/deploy/backup.

Instalação do navegador E2E:

```bash
npm run test:e2e:install
```

Checks pesados não devem ser adicionados ao PR normal apenas por disponibilidade. O critério é risco material da mudança.

## Testes de operação

`npm run test:ops` agrega os contratos shell versionados de:

- instalação/update systemd;
- Tailscale Serve;
- Tailscale Funnel;
- hardening Tailscale.

Esses testes usam inspeção/fixtures e não são equivalentes a `service:install`, `service:update` ou mudanças reais de perfil Tailscale. Execute-os quando scripts operacionais forem alterados.

## Testes que valem a manutenção

Priorize testes que protegem:

- regras de domínio e contratos HTTP;
- autenticação, autorização e isolamento entre usuários;
- filesystem, path confinement e operações destrutivas;
- SQLite, migrations, concorrência e rollback;
- importação, URLs/processos externos e SSRF;
- regressões reproduzíveis;
- comportamento relevante de UI e acessibilidade.

Evite testes que apenas repetem configuração, texto de arquivo ou detalhe incidental de implementação sem proteger um contrato material.

## Coverage

Coverage é uma ferramenta de diagnóstico, não uma meta percentual do produto. Uma porcentagem alta não substitui bons cenários, testes negativos e revisão do risco. Não crie testes apenas para elevar um número e não afrouxe assertions corretas para preservar métricas.

## Falhas e flaky tests

Teste falhou: reproduza, identifique a causa e corrija o problema real. Não classifique como flaky sem evidência e não remova um teste válido apenas para deixar o CI verde.

## Fluxo completo

Setup local, execução e gate antes do PR: [`DEVELOPMENT.md`](DEVELOPMENT.md).

Preflight e validação de produção: [`PRODUCTION.md`](PRODUCTION.md).
