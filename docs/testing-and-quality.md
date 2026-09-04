# Testes e qualidade

A suíte do Home Music deve proteger comportamento e risco real, sem transformar toda validação disponível em custo fixo de cada pull request.

## Gate normal de PR

O CI obrigatório mantém o caminho curto:

```text
npm ci
npm run typecheck
npm test
npm run build
```

`npm test` cobre as suítes funcionais de servidor/web e o contrato executável de verificação de produção.

## Checks direcionados

Use validações adicionais quando o risco da mudança justificar:

- `npm run test:security` para autenticação, autorização, administração, importação e outras fronteiras sensíveis;
- `npm run test:policy` para políticas de Dependabot e lifecycle scripts; esse check também roda no workflow semanal/manual de audit;
- `npm run benchmark:large-library` e benchmarks relacionados para mudanças com risco de regressão de escala/performance;
- `npm run smoke:production` e `npm run smoke:backup-restore` para mudanças operacionais/deploy/backup;
- `npm run e2e` para fluxos críticos de usuário ou integrações fullstack que precisem de navegador real.

Checks pesados não devem ser adicionados ao PR normal apenas por disponibilidade. O critério é risco material da mudança.

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

Coverage é uma ferramenta de diagnóstico, não uma meta percentual do produto. Uma porcentagem alta não substitui bons cenários, testes negativos e revisão do risco. Não criar testes apenas para elevar um número e não afrouxar assertions corretas para preservar métricas.

## Falhas e flaky tests

Teste falhou: reproduza, identifique a causa e corrija o problema real. Não classifique como flaky sem evidência e não remova um teste válido apenas para deixar o CI verde.
