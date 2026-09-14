# Agent role overlays — design

## Contexto

O `AGENTS.md` raiz do Home Music acumulou regras duráveis do projeto e detalhes operacionais de um workflow externo. Isso acopla o repositório a um orquestrador específico e dificulta ter mais de um workflow de agents sem duplicar protocolo dentro do projeto.

## Decisão

O Home Music passa a separar três camadas de instrução:

1. `AGENTS.md` raiz e `AGENTS.md` locais continuam sendo a fonte das invariantes duráveis do Home Music.
2. Cada workflow externo continua sendo a fonte do próprio contrato, papel global, estados, handoff e autorizações.
3. O Home Music fornece overlays locais por papel, com somente contexto específico do projeto.

Os overlays ficam em:

- `agent-orchestrator/agents/<papel>.md`;
- `agent-workflow-browser/agents/<papel>.md`.

Os nomes seguem os papéis `00-orchestrator` a `07-maintainer` usados pelos dois workflows atuais.

## Descoberta

Os agents globais já são instruídos a ler o `AGENTS.md` do repositório-alvo. O `AGENTS.md` raiz do Home Music passa a instruir o executor a ler também o overlay que corresponda ao seu identificador/papel, quando existir.

Isso evita duplicar o contrato externo no Home Music e não exige que o repositório-alvo conheça detalhes internos de transição de cada workflow.

## Conteúdo dos overlays

Cada overlay contém apenas regras locais relevantes para aquele papel, por exemplo:

- fontes de verdade e áreas do Home Music que devem ser lidas;
- padrões de arquitetura e ownership do projeto;
- UX “simples, ágil e funcional”;
- gates locais e distinção entre teste local, CI, E2E e validação manual;
- isolamento entre DEV e produção;
- distinção entre capacidade local de edição e autorização de publicação.

Não devem ser copiados para os overlays:

- state machine;
- protocolo terminal;
- formato de handoff;
- autorizações específicas do workflow;
- missão global do papel além do mínimo necessário para contextualizar o arquivo.

## Compatibilidade

A mudança é somente documental no Home Music. Não altera código de produto, tasks existentes, branches de feature, PRs de produto ou comportamento de runtime.

Se um workflow externo deixar de instruir o agent a ler o `AGENTS.md` do repositório-alvo, a descoberta dos overlays precisará ser tratada naquele workflow. O Home Music não deve duplicar lógica de runner para compensar isso.

## Escopo futuro

Depois de validar este padrão no Home Music, ele pode ser replicado em outros projetos. Cada projeto deve manter seus próprios overlays locais; o contrato global continua centralizado nos workflows externos.
