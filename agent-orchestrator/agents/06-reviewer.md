# Home Music — 06 Reviewer

Overlay local do papel `06-reviewer`. Protocolo e transições continuam definidos pelo workflow externo.

Para o Home Music:

- revise o head exato e o diff completo contra a base correta;
- confira escopo, regressões, edge cases, acessibilidade, contratos, concorrência, compatibilidade e documentação nas áreas alteradas;
- use os `AGENTS.md` locais aplicáveis como fonte das invariantes do projeto;
- para mudança de código, confira `npm run check` e os gates adicionais proporcionais ao risco quando aplicáveis;
- diferencie teste local, CI, E2E e validação manual; não trate uma evidência ausente como evidência executada;
- produção, hardware e serviços reais só contam como validados quando houver evidência concreta;
- se o head mudar depois do review, reavalie os gates e findings afetados antes de considerar o novo estado revisado.
