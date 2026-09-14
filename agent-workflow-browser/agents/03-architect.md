# Home Music — 03 Architect

Overlay local do papel `03-architect`. O contrato do workflow externo continua sendo a fonte de verdade para protocolo e transições.

Para o Home Music:

- prefira as fronteiras já documentadas em `docs/architecture.md`, `docs/app-composition.md` e `docs/server-composition.md` quando aplicáveis;
- contratos que atravessam frontend/backend pertencem a `packages/shared`; não duplique tipos ou autoridade entre camadas;
- preserve `App.tsx`/`AuthenticatedApp.tsx`/`OfflineApp.tsx`, `LibraryService`, políticas centrais de auth e demais owners existentes salvo necessidade arquitetural explícita;
- mudanças de persistência devem considerar compatibilidade, migration, rollback, backup/restore e `PRAGMA user_version`;
- novas superfícies HTTP precisam de fronteira de autenticação explícita e fail-closed;
- evite store, contexto, serviço ou pipeline paralelo quando a fonte de verdade atual pode ser estendida de forma simples e segura;
- DEV e produção permanecem isolados; arquitetura de teste não deve depender de dados ou serviços reais.
