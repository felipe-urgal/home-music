# AGENTS.md

## Objetivo

Trabalhe de forma autônoma, incremental e verificável. Prefira a menor solução completa e de menor manutenção.

## Fluxo

1. Inspecione o comportamento atual.
2. Identifique owner, impacto e regressões.
3. Preserve o que estiver fora do escopo.
4. Implemente com KISS/YAGNI.
5. Valide proporcionalmente ao risco.
6. Revise o diff final.

## Engenharia

- SOLID é ferramenta, não obrigação de criar camadas.
- Evite abstrações, services, helpers e stores genéricos sem necessidade concreta.
- Não misture regra de negócio com UI quando existir comportamento que precise ser protegido por testes.
- Não esconda falhas relevantes.
- Mudanças em autenticação, biblioteca, importação, streaming ou persistência exigem atenção especial a regressões.

## Invariantes

- A biblioteca existente continua sendo a autoridade canônica; não crie um segundo catálogo.
- Preserve isolamento de dados entre usuários.
- Operações de arquivo não podem escapar dos diretórios permitidos.
- Não exponha a porta 8787 diretamente à internet.
- Funcionalidade opcional não pode quebrar o happy path local.

## Validação

    npm run check

Use quando aplicável:

    npm run test:e2e
    npm run test:security
    npm run smoke:production

## Documentação

- docs/DEVELOPMENT.md
- docs/TASK_TEMPLATE.md
- docs/CODE_REVIEW.md

Não produza documentação histórica por padrão; use Git, issues e PRs para histórico.
