# Roadmap técnico

Este documento descreve **o estado técnico corrente e o próximo trabalho relevante** do Home Music.

O histórico detalhado acumulado até a fase 14 foi preservado em [`history/roadmap-through-phase-14.md`](history/roadmap-through-phase-14.md). Documentos de implementação da antiga fase 7.5 ficam em [`history/phase-7.5/`](history/phase-7.5/).

## Estado em 2026-09-06

- **Fase 7.5 — multiusuário/autenticação:** concluída e incorporada à arquitetura atual. Fonte canônica: [`multi-user-auth.md`](multi-user-auth.md).
- **Fase 14 — portabilidade de dados pessoais:** implementação concluída na `main` com o PR #324. Contrato atual: [`personal-data-portability.md`](personal-data-portability.md).
- **Fase 15 — Library Assistant:** fase ativa, coordenada pela issue #310 e pelo plano [`library-assistant-plan.md`](library-assistant-plan.md).
- Correções independentes de PWA/offline continuam sendo tratadas fora da fase 15 quando não alteram seu escopo.

A `main` atual já contém exportação e importação de dados pessoais por usuário, validação/dry-run, política de merge e E2E focado de importação pessoal no CI.

## Fase 15 — Library Assistant

Objetivo: evoluir a organização e correção da biblioteca para um fluxo assistido, seguro e reversível, sem transformar sugestões em mutações implícitas.

Princípios:

- identificar arquivos/conteúdo de forma estável antes de sugerir mudança;
- separar descoberta/análise de aplicação;
- preview antes de mutação;
- operações em lote precisam de resultado rastreável e rollback quando aplicável;
- backend continua sendo a fronteira de segurança e filesystem confinement;
- nenhuma sugestão deve inventar metadata como fato confirmado;
- o usuário mantém controle explícito sobre alterações físicas e metadata persistida.

### Tracking

Umbrella: **#310 — Library Assistant**.

Issues planejadas:

| Issue | Entrega |
| --- | --- |
| #311 | content hashing / identidade estável de arquivo |
| #312 | importação cross-filesystem segura |
| #313 | serviços de identidade de mídia |
| #314 | rename/move orientado por hash |
| #315 | matching de release |
| #316 | detecção de boundaries de episódios/faixas |
| #317 | política/runtime de edição |
| #318 | aplicação em lote + rollback |
| #319 | sugestões e reporting |
| #320 | E2E e critérios de aceitação da fase |

O detalhamento de arquitetura, riscos, etapas e critérios está em [`library-assistant-plan.md`](library-assistant-plan.md). Se o plano e uma implementação divergirem, código/testes e a issue executada têm precedência; este roadmap deve ser atualizado no mesmo PR que consolidar a decisão.

## Portabilidade pessoal — estado consolidado

O ciclo da fase 14 deixou como contrato atual:

- exportação versionada dos dados pertencentes ao usuário autenticado;
- importação com validação e dry-run antes da aplicação;
- merge explícito sem permitir cross-user ownership;
- superfície de Minha conta para importar/exportar;
- regressões de segurança e smoke de backup/restore promovidos ao CI;
- E2E focado de `personal-data-import` promovido ao CI.

Detalhes de produto/API: [`personal-data-portability.md`](personal-data-portability.md).

Detalhes de identidade/ownership: [`multi-user-auth.md`](multi-user-auth.md).

## Trabalho paralelo fora da fase 15

Issues podem permanecer fora da fase quando corrigem comportamento já existente sem mudar o escopo do Library Assistant. No momento da atualização deste documento, existem correções abertas relacionadas a PWA/offline, como #327 e #328.

O roadmap não replica todos os bugs abertos. Para estado operacional de issues, o GitHub é a fonte de verdade.

## Critério para adicionar uma nova fase

Uma nova fase deve entrar aqui quando houver:

1. objetivo de produto/arquitetura claro;
2. issue umbrella ou decisão equivalente;
3. fronteiras explícitas de escopo;
4. riscos e critérios de aceitação identificados;
5. relação com documentação canônica definida.

Planos exploratórios devem usar nome explícito (`*-plan.md`, ADR ou issue) e não ser apresentados como comportamento já entregue.

## Fontes de verdade

Ordem prática para resolver divergências:

1. código, testes, `package.json`, workflows e contratos executáveis;
2. documentação canônica atual (`README.md`, `DEVELOPMENT.md`, `PRODUCTION.md`, `architecture.md` e docs de domínio);
3. este roadmap e issues abertas;
4. documentos em `docs/history/` como contexto histórico.

Não use documentos `phase-*` arquivados como especificação operacional atual.
