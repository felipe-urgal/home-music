# Testes e qualidade

A suíte do Home Music deve proteger comportamento e risco real sem transformar toda validação disponível em custo fixo de cada pull request.

## Baseline local de PR

O gate canônico para desenvolvimento é:

```bash
npm run check
```

Ele executa:

```text
typecheck
-> testes funcionais
-> build
```

Esse é o baseline que todo PR deve reproduzir localmente antes de revisão.

## Gate obrigatório do CI

O workflow `.github/workflows/ci.yml` é a fonte executável do CI. Atualmente, depois de instalar dependências, ele roda:

```text
npm ci --no-audit --no-fund
-> npm run check
-> npm run test:security
-> npm run smoke:backup-restore
-> npm run test:e2e:install
-> npx playwright test e2e/personal-data-import.spec.ts --workers=1
```

Portanto, `npm run check` continua sendo o baseline compartilhado, mas **não representa sozinho todo o CI obrigatório**.

Os gates adicionais foram mantidos no workflow porque protegem fronteiras de alto impacto: regressões de segurança, consistência de backup/restore e a importação de dados pessoais.

## Checks direcionados

Use validações adicionais quando o risco da mudança justificar:

- `npm run test:policy` para políticas de Dependabot e lifecycle scripts; esse check também roda no workflow semanal/manual de audit;
- `npm run test:ops` para contratos shell de systemd e Tailscale;
- `npm run test:e2e` para fluxos críticos de usuário ou integrações fullstack que precisem da suíte completa de navegador;
- `npm run benchmark:large-library` e benchmarks relacionados para mudanças com risco de regressão de escala/performance;
- `npm run smoke:production` para mudanças operacionais/deploy;
- `npm run smoke:backup-restore` pode ser repetido localmente quando a mudança tocar SQLite, backup ou restore;
- `npm run test:security` pode ser repetido localmente quando a mudança tocar autenticação, autorização, administração, importação ou outras fronteiras sensíveis.

Instalação do navegador E2E:

```bash
npm run test:e2e:install
```

A suíte E2E completa, benchmarks, coverage e smokes adicionais não devem entrar no custo fixo de todo PR apenas por disponibilidade. O critério é risco material da mudança; o que for promovido a gate fixo deve estar explícito no workflow e neste documento.

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
