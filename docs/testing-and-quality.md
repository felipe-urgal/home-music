# Testes e qualidade

A suíte do Home Music deve proteger comportamento e risco real sem transformar toda validação disponível em custo fixo de cada pull request.

## Baseline local de PR

O gate canônico para desenvolvimento é:

```bash
npm run check
```

Ele executa typecheck, testes funcionais e build. Esse é o baseline que todo PR deve reproduzir localmente antes de revisão, mas não representa sozinho todo o CI obrigatório.

## Gate obrigatório do CI

O workflow `.github/workflows/ci.yml` é a fonte executável. No estado atual ele executa, em ordem:

```text
npm ci --no-audit --no-fund
-> TV regression gate
-> npm run check
-> npm run test:security
-> npm run smoke:backup-restore
-> instala dependências E2E + Chromium
-> Mobile crossfade E2E
-> TV remote control E2E
-> Personal data import E2E
-> Library Assistant E2E
```

Os E2Es fixos são deliberadamente direcionados: entram no custo de todo PR porque protegem regressões de alto impacto que já justificaram promoção ao workflow principal.

### TV regression gate

Executa os testes focados de controles e crossfade antes do quality gate completo para falhar cedo em regressões do modo TV.

### TV remote control E2E

Executa `e2e/tests/tv-remote-control.spec.ts` no desktop Chromium contra o build/servidor descartáveis reais. O cenário usa dois contexts de navegador da mesma conta, prova que a superfície mobile não cria `<audio>` e valida foco do modal, play/pause, próxima faixa e seek TV ↔ celular.

Ownership entre contas não é duplicado no Playwright: a fronteira é protegida pelos testes HTTP reais de `apps/server/src/tv-remote-routes.test.ts`, que verificam 404 para outro usuário.

## Checks direcionados

Use validações adicionais quando o risco da mudança justificar:

- `npm run test:policy` para políticas de Dependabot e lifecycle scripts;
- `npm run test:ops` para contratos shell de systemd/Tailscale;
- `npm run test:e2e` para a suíte browser completa;
- `npm run benchmark:large-library` e benchmarks relacionados para risco de escala/performance;
- `npm run smoke:production` para mudanças operacionais/deploy;
- `npm run smoke:backup-restore` ao tocar SQLite, backup ou restore;
- `npm run test:security` ao tocar autenticação, autorização, administração, importação ou outra fronteira sensível.

Instalação de navegador E2E:

```bash
npm run test:e2e:install
```

A suíte E2E completa, benchmarks, coverage e smokes adicionais não entram automaticamente no custo fixo. O critério continua sendo risco material; qualquer promoção a gate fixo deve aparecer no workflow e neste documento.

## Testes de operação

`npm run test:ops` agrega contratos shell versionados de instalação/update systemd, Tailscale Serve, Tailscale Funnel e hardening Tailscale. Eles usam fixtures/inspeção e não equivalem a executar alterações reais do serviço ou do perfil Tailscale.

## Testes que valem a manutenção

Priorize testes que protegem:

- regras de domínio e contratos HTTP;
- autenticação, autorização e isolamento entre usuários;
- filesystem, path confinement e operações destrutivas;
- SQLite, migrations, concorrência e rollback;
- importação, URLs/processos externos e SSRF;
- regressões reproduzíveis;
- comportamento relevante de UI, foco e acessibilidade.

Evite testes que apenas repetem configuração, texto de arquivo ou detalhe incidental de implementação sem proteger um contrato material.

## Coverage

Coverage é ferramenta de diagnóstico, não meta percentual. Uma porcentagem alta não substitui cenários úteis, testes negativos e revisão de risco.

## Falhas e flaky tests

Quando um teste falhar, reproduza, identifique a causa e corrija o problema real. Não classifique como flaky sem evidência e não remova um teste válido apenas para deixar o CI verde.

## Fluxo completo

Setup local e desenvolvimento: [`DEVELOPMENT.md`](DEVELOPMENT.md).

Preflight e produção: [`PRODUCTION.md`](PRODUCTION.md).

Playwright: [`../e2e/README.md`](../e2e/README.md).
