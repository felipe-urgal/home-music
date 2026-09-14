# Agent role overlays implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar as invariantes duráveis do Home Music das instruções específicas por papel de dois workflows externos.

**Architecture:** O `AGENTS.md` raiz permanece como fonte das regras globais do projeto e passa a descobrir overlays locais por papel. `agent-orchestrator/agents/` e `agent-workflow-browser/agents/` expõem o mesmo conjunto de identificadores `00`–`07`, contendo apenas contexto específico do Home Music; contratos e state machines permanecem nos projetos externos.

**Tech Stack:** Markdown, Git/GitHub.

**Spec:** `docs/superpowers/specs/2026-09-14-agent-role-overlays-design.md`

## Global Constraints

- Não alterar código de produto.
- Não alterar tasks, PRs ou branches da HM-002.
- Não duplicar state machine, protocolo terminal ou autorizações dos workflows externos.
- Preservar os `AGENTS.md` locais existentes.
- Manter `AGENTS.md` raiz focado em regras duráveis do Home Music.
- PR separado e sem merge automático.

---

### Task 1: Limpar o `AGENTS.md` raiz

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: regras globais e locais já existentes no Home Music.
- Produces: mecanismo de descoberta dos overlays e remoção do acoplamento nominal ao antigo `agent-workflow`.

- [x] Remover a seção `## Integração com agent-workflow` e subseções associadas.
- [x] Remover referências residuais nominais a `agent-workflow` em fontes de verdade, Git/PR e definição de pronto.
- [x] Adicionar os diretórios `agent-orchestrator/agents/` e `agent-workflow-browser/agents/` como overlays por papel.
- [x] Preservar as invariantes existentes de arquitetura, segurança, dados, validação, produção, Git e readiness.

### Task 2: Adicionar overlays locais por papel

**Files:**
- Create: `agent-orchestrator/agents/00-orchestrator.md` … `07-maintainer.md`
- Create: `agent-workflow-browser/agents/00-orchestrator.md` … `07-maintainer.md`

**Interfaces:**
- Consumes: identificadores de papel usados pelos dois workflows externos.
- Produces: contexto Home Music específico para cada papel, descoberto a partir do `AGENTS.md` raiz.

- [x] Criar overlays para `00-orchestrator` a `07-maintainer`.
- [x] Manter os overlays curtos e específicos do Home Music.
- [x] Não copiar state machine, formato de handoff ou regras de autorização dos projetos externos.
- [x] Registrar no Senior Engineer a distinção entre capacidade local de edição e autorização de publicação.

### Task 3: Registrar decisão e validar escopo

**Files:**
- Create: `docs/superpowers/specs/2026-09-14-agent-role-overlays-design.md`
- Create: `docs/superpowers/plans/2026-09-14-agent-role-overlays.md`

**Interfaces:**
- Consumes: design aprovado pelo usuário.
- Produces: decisão arquitetural e plano rastreáveis.

- [x] Documentar a separação entre regras locais, overlays e contratos externos.
- [x] Confirmar que o diff não contém código de produto nem arquivos da HM-002.
- [x] Revisar o diff completo antes de abrir o PR.
- [x] Abrir PR separado contra `main`, sem merge.
