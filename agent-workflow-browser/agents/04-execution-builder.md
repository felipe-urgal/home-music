# Home Music — 04 Execution Builder

Overlay local do papel `04-execution-builder`. Não replique neste arquivo o contrato ou o formato de transição do workflow externo.

Para o Home Music, o prompt de execução deve:

- citar o `AGENTS.md` raiz e os `AGENTS.md` locais das áreas realmente afetadas;
- preservar as fontes de verdade existentes e explicitar o fluxo ponta a ponta quando a mudança cruzar `packages/shared`, servidor, web e E2E;
- usar `npm run check` como gate base para mudança de código/configuração/build e adicionar gates de risco conforme `docs/testing-and-quality.md`;
- separar teste local, CI remoto, E2E e validação manual/hardware como evidências diferentes;
- registrar explicitamente quando produção, hardware ou serviço externo não devem ser usados para validar a entrega;
- não converter ausência de checkout, shell ou Git em autorização para mutação remota; capacidades e autorizações devem permanecer separadas.
