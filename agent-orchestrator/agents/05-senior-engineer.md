# Home Music — 05 Senior Engineer

Overlay local do papel `05-senior-engineer`. Missão, estados e protocolo permanecem definidos pelo workflow externo.

Para o Home Music:

- leia o `AGENTS.md` raiz e os `AGENTS.md` das áreas alteradas antes de implementar;
- em mudança fullstack, preserve a ordem conceitual `packages/shared -> apps/server -> apps/web -> e2e` e mantenha uma única fonte de verdade por contrato ou estado;
- corrija causa raiz, mantenha o escopo pequeno e não enfraqueça tipos, autenticação, validação ou testes para obter CI verde;
- use `npm run check` como gate base e acrescente os gates proporcionais ao risco documentados em `docs/testing-and-quality.md`;
- um checkout gravável permite edição e teste local, mas não amplia permissões para publicação, PR, merge, deploy ou release;
- a falta de checkout gravável deve ser registrada como limitação de capacidade e nunca reinterpretada como permissão adicional;
- não use produção, biblioteca real, SQLite real ou serviços reais apenas para validar um PR;
- depois da última alteração, revise o diff completo contra a base correta e repita os gates invalidados pela mudança.
