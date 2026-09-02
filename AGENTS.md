# AGENTS.md — fluxo de desenvolvimento do Home Music

Este arquivo define como agentes de IA e colaboradores automatizados devem trabalhar neste repositório.

O objetivo não é apenas produzir código que compile. Toda alteração deve ser tratada com postura de **engenheiro fullstack sênior**, considerando produto, UX, frontend, backend, contratos, persistência, concorrência, segurança, operação em produção, testes e documentação.

> Regra principal: **nenhuma tarefa está pronta sem auto code review completo no head final**. Se qualquer arquivo for alterado depois do review, o review anterior deixa de valer para o gate final.

---

## 1. Antes de alterar código

Não comece implementando pela primeira hipótese.

Leia, no mínimo:

1. a issue/tarefa atual;
2. o PR aberto, quando existir;
3. `README.md`;
4. `docs/README.md`;
5. `docs/architecture.md`;
6. `docs/roadmap.md`;
7. os documentos específicos do domínio alterado;
8. os testes próximos do código que será modificado.

Depois inspecione o fluxo **de ponta a ponta** relevante:

```text
UI
 ↓
client/hook
 ↓
contrato compartilhado
 ↓
rota Fastify
 ↓
serviço/store
 ↓
SQLite / filesystem / processo externo
 ↓
resposta
 ↓
estado exibido na UI
```

Não assuma que um documento antigo representa o comportamento atual. Documentos `phase-*` podem preservar histórico. Para estado corrente, prefira `README.md`, `docs/README.md`, `docs/architecture.md`, documentos funcionais atuais, código e testes.

### Antes de editar, responda mentalmente

- Qual é a fonte de verdade deste estado?
- Existe outra implementação parecida que deve ser reutilizada?
- A mudança afeta frontend, backend ou contrato compartilhado?
- Existe efeito em autenticação/autorização?
- Existe risco de race condition ou resposta assíncrona obsoleta?
- Existe operação destrutiva, filesystem, SQLite, upload, URL externa ou processo filho?
- Qual comportamento antigo precisa continuar funcionando?
- Quais testes provam a mudança e quais testes negativos impedem regressão?

---

## 2. Postura obrigatória de engenharia

Trabalhe como **fullstack sênior**, não como gerador de patch local.

Isso significa:

- entender o problema antes de escrever código;
- procurar a causa raiz, não mascarar o sintoma;
- considerar o sistema inteiro, inclusive produção;
- manter uma única fonte de verdade por estado/regra;
- evitar duplicação de lógica entre mobile/desktop, frontend/backend ou endpoints;
- preferir mudanças pequenas e explícitas a abstrações prematuras;
- não introduzir dependência nova sem necessidade clara;
- não enfraquecer segurança, tipos ou testes para fazer CI passar;
- não alterar comportamento fora do escopo sem justificar;
- remover código morto criado/descoberto pela própria mudança quando for seguro fazê-lo;
- preservar compatibilidade de dados e migrations existentes;
- escrever código legível para o próximo mantenedor, não apenas para o agente atual.

### Não fazer

- não usar `any` para escapar de modelagem que pode ser tipada;
- não duplicar contratos manualmente se eles pertencem a `packages/shared`;
- não confiar em validação do frontend como controle de segurança;
- não inventar estado otimista que possa divergir do backend sem estratégia de reconciliação;
- não silenciar erro importante só para melhorar UX;
- não trocar teste correto por teste mais frouxo quando ele expõe um bug;
- não assumir que “CI verde anterior” vale depois de novos commits;
- não fazer merge com blocker/high/medium conhecido pendente.

---

## 3. Fluxo padrão de trabalho

O fluxo normal é:

```text
issue / escopo aprovado
        ↓
branch própria
        ↓
investigação
        ↓
implementação incremental
        ↓
testes focados
        ↓
typecheck / suíte relevante
        ↓
auto code review completo
        ↓
correções do review
        ↓
reexecutar validações afetadas
        ↓
auto code review final no novo head
        ↓
PR documentado
        ↓
CI completo verde no head final
        ↓
APPROVE / MERGE
```

Quando o usuário pedir explicitamente para ampliar um PR já aberto, o trabalho adicional pode permanecer na mesma branch/PR. Nesse caso, atualize o escopo/documentação do PR e **repita todos os gates no head final**.

### Branches

Use nomes objetivos, por exemplo:

```text
feature/<descricao>
bugfix/<descricao>
hotfix/<descricao>
refactor/<descricao>
docs/<descricao>
style/<descricao>
test/<descricao>
```

Não crie branch adicional sem necessidade se a tarefa foi explicitamente autorizada dentro de um PR já em andamento.

---

## 4. Contratos fullstack

Mudança de API deve ser analisada nos dois lados.

Quando o formato atravessa frontend/backend:

- preferir contratos/tipos em `packages/shared`;
- validar payload no backend mesmo que o frontend já valide;
- manter erros públicos seguros e acionáveis;
- não expor paths físicos, stack traces, cookies, tokens ou segredos;
- atualizar clientes, estados vazios/loading/error e testes correspondentes;
- revisar compatibilidade com chamadas existentes.

Uma alteração não está completa se apenas um lado foi atualizado.

---

## 5. Frontend e UX

O Home Music deve permanecer simples, ágil e funcional.

### Estado

- evitar duas fontes de verdade para o mesmo dado;
- proteger telas contra respostas assíncronas obsoletas;
- depois de salvar/deletar/mover, reconciliar com a fonte canônica;
- seleção em lote não pode permanecer invisível depois de filtro/busca que esconda os itens;
- loading não deve parecer ativo quando a ação está desabilitada;
- estados nunca verificados não devem aparecer como “saudáveis”.

### Responsividade

Testar mentalmente e, quando possível, com E2E:

- mobile;
- tablet;
- desktop;
- textos/caminhos/nomes longos;
- lista vazia;
- loading;
- erro;
- estado parcial;
- lista grande.

As superfícies atuais de Minha conta/Administração usam layout fluido; não reintroduzir `max-width` estreito sem motivo funcional.

### Acessibilidade

Revisar:

- navegação por teclado;
- foco visível;
- ordem de foco;
- `label`/nome acessível;
- `disabled` real;
- dialogs/confirmações;
- contraste;
- touch targets;
- checkbox/seleção;
- feedback de erro/sucesso sem depender apenas de cor.

### Operações destrutivas

- separar visualmente ação reversível de ação permanente;
- não colocar delete permanente como ação casual repetida em toda linha;
- exigir confirmação explícita;
- lote de exclusão permanente mantém confirmação digitada quando prevista;
- preferir quarentena/restauração antes de delete físico.

---

## 6. Backend, autenticação e autorização

O backend é a fronteira real de segurança.

### Política

- rotas sensíveis devem usar a política central apropriada;
- `/api/admin/*` exige `admin`;
- `user` comum deve continuar recebendo `403` para operação administrativa;
- ownership pessoal deve ser derivado da sessão, não de `userId` arbitrário do cliente;
- quando necessário para evitar enumeração de recurso de outro usuário, usar `404` conforme política existente.

### Mutações autenticadas

Mutações da aplicação usam o header:

```text
X-Home-Music-Request: 1
```

Não adicionar nova mutação esquecendo essa proteção e seus testes negativos.

### Sessões e senhas

- nunca logar senha, hash completo, cookie ou token;
- não persistir senha temporária no frontend;
- mudança sensível de conta deve preservar invariantes de revogação;
- nunca permitir remover/rebaixar o último administrador ativo;
- não criar caminho de auto-lockout administrativo.

---

## 7. Filesystem e operações destrutivas

Qualquer operação de arquivo deve ser tratada como superfície de segurança.

Revisar obrigatoriamente:

- path traversal;
- caminho absoluto inesperado;
- `..`/encoding equivalente;
- symlink escape;
- arquivo não regular;
- colisão/no-clobber;
- corrida entre validação e uso;
- rollback em falha parcial;
- comportamento quando diretório fica indisponível;
- concorrência com scan/importação/outro job.

O frontend nunca deve implementar `rename`, `unlink` ou confinement por conta própria.

`MUSIC_DIR` é a fronteira física da biblioteca. Operações administrativas devem permanecer confinadas a ela ou aos diretórios explicitamente seguros de staging/quarentena/cache.

### Lixeira

- biblioteca ativa → quarentena é o caminho destrutivo padrão;
- restauração é preferível quando aplicável;
- exclusão permanente é explícita;
- lote destrutivo precisa preservar confirmação forte;
- falha parcial deve ser reportada por item e não mascarada.

### Integridade

A ação **Verificar agora** é read-only.

Nunca reutilize o scan normal para satisfazer uma auditoria de Integridade se isso puder reconciliar/remover registros.

---

## 8. Importação, URLs e processos externos

O pipeline de importação deve continuar desacoplado da origem:

```text
origem
 ↓
staging/scratch
 ↓
validação
 ↓
metadata
 ↓
duplicatas
 ↓
destino seguro
 ↓
promoção
 ↓
indexação incremental
```

### URL

Revisar SSRF em qualquer alteração:

- protocolos permitidos;
- localhost;
- redes privadas/reservadas;
- DNS/rebinding quando aplicável;
- redirects;
- timeout;
- limite de bytes;
- Content-Type não confiável;
- cleanup em falha.

### Provider/processo filho

- usar API de processo sem shell quando possível;
- argumentos como array, não concatenação de comando;
- timeout/cancelamento;
- limite de saída/buffer;
- cleanup da árvore de processos;
- saída do provider é entrada não confiável;
- provider nunca escreve diretamente em `MUSIC_DIR`.

### Retry

Retry é uma **nova tentativa**, não reaproveitamento silencioso de staging inconsistente.

---

## 9. SQLite e persistência

Mudanças de persistência exigem revisão de compatibilidade e falhas parciais.

Verificar:

- migration idempotente/ordenada;
- `PRAGMA user_version` quando pertence ao schema principal;
- foreign keys;
- transação para mudanças relacionadas;
- rollback em erro;
- comportamento com dados de versão anterior;
- índices/constraints coerentes;
- concorrência e locks;
- backup/restore;
- teste reabrindo o banco quando persistência é relevante.

Nunca apague dados existentes apenas para simplificar uma migration.

---

## 10. Testes obrigatórios

Escolha testes proporcionais ao risco, mas o gate final deve cobrir o sistema inteiro relevante.

### Base local recomendada

```bash
npm ci
npm run typecheck
npm run test:security
npm test
npm run benchmark:large-library
npm run build
npm run smoke:production
```

O root possui também:

```bash
npm run smoke:backup-restore
npm run e2e
```

`npm run test:security` é o gate transversal de regressões negativas de Administração/Importação. `npm run benchmark:large-library` é o guard de regressão grave com dataset sintético; ele não substitui testes funcionais e seus limites não são SLA de produto.

Use E2E sempre que a mudança afetar fluxo de usuário, navegação, comportamento responsivo ou integração fullstack que a suíte possa cobrir.

### Testes focados primeiro

Durante desenvolvimento, execute primeiro a suíte/arquivo diretamente afetado para obter feedback rápido. Depois execute os gates amplos.

### Testes negativos

Toda mudança de segurança precisa provar também o que **não pode** acontecer.

Exemplos:

- `user` chamando rota admin;
- mutação sem header anti-CSRF;
- path traversal/symlink;
- URL privada/redirect SSRF;
- payload malformed/oversized;
- operação concorrente proibida;
- delete sem confirmação;
- stale async response sobrescrevendo seleção nova;
- falha parcial preservando estado consistente.

### Quando teste falha

Não assuma “flaky” antes de investigar.

Procedimento:

1. reproduzir;
2. entender causa;
3. distinguir regressão real de instabilidade pré-existente;
4. corrigir a causa quando pertence ao PR;
5. não afrouxar assert correto para ficar verde;
6. reexecutar o teste e a suíte afetada.

Se um teste realmente for flaky e não causado pela mudança, documente evidência e risco residual; não esconda a falha.

---

## 11. Auto code review obrigatório

**Sempre executar antes de considerar a tarefa pronta.**

O review deve analisar o diff completo contra a base do PR e o comportamento resultante, não apenas os últimos arquivos editados.

### Severidade

Classifique findings como:

- **BLOCKER** — risco de perda de dados, vulnerabilidade, fluxo principal quebrado, comportamento destrutivo inesperado ou impossibilidade de deploy;
- **HIGH** — bug sério, autorização incorreta, corrupção/inconsistência provável, regressão importante;
- **MEDIUM** — bug funcional/UX relevante, race condition limitada, estado inconsistente, cobertura insuficiente de comportamento importante;
- **LOW** — melhoria pequena, dívida ou risco residual não bloqueante.

### Checklist técnico

Revisar no mínimo:

#### Correção
- requisito realmente atendido;
- edge cases;
- vazio/loading/error;
- concorrência;
- stale async;
- falha parcial;
- retry/idempotência;
- regressão de comportamento existente.

#### Frontend
- fonte de verdade;
- responsividade;
- acessibilidade;
- teclado/foco;
- seleção/filtros;
- estado destrutivo;
- feedback de erro/sucesso.

#### Backend
- validação de input;
- contrato HTTP;
- códigos de status;
- autorização;
- ownership;
- anti-CSRF;
- sanitização de erro.

#### Segurança
- SSRF;
- path traversal;
- symlink;
- shell/process injection;
- secret leakage;
- permissões;
- operações destrutivas;
- fail-open vs fail-closed.

#### Dados
- migration;
- transação;
- compatibilidade;
- backup/restore;
- consistência memória ↔ SQLite ↔ filesystem.

#### Qualidade
- código morto;
- duplicação;
- nomes;
- tipos;
- abstrações desnecessárias;
- dependência nova;
- documentação divergente.

#### Testes
- caminho feliz;
- casos negativos;
- regressão;
- falha parcial;
- autorização;
- CI adequado ao risco.

### Regra de correção

Qualquer **BLOCKER, HIGH ou MEDIUM** encontrado deve ser corrigido antes do merge, salvo decisão explícita do mantenedor aceitando o risco.

Depois da correção:

1. reexecute os testes afetados;
2. reexecute gates amplos necessários;
3. faça **novo auto code review completo**;
4. use o novo head como referência do gate final.

### Saída do review

O relatório final deve ser objetivo:

```text
Auto code review

BLOCKER: 0
HIGH: 0
MEDIUM: 0
LOW: <n>

Findings:
- ...

Riscos residuais:
- ...

Validação:
- typecheck: pass
- security regressions: pass
- tests: pass
- large-library benchmark: pass
- build: pass
- smoke: pass
- E2E/CI: pass ou justificativa

VERDICT: APPROVE / BLOCK
```

Não usar `APPROVE` se CI do **head final** ainda não estiver verde quando CI for parte do gate.

---

## 12. Padrão de Pull Request

O PR deve permitir que outra pessoa entenda o que mudou sem reconstruir a conversa.

### Título

Use prefixo semântico simples:

```text
feat: ...
fix: ...
style: ...
refactor: ...
docs: ...
test: ...
chore: ...
```

O título descreve o resultado, não o processo.

### Corpo mínimo

```md
## Resumo
O que mudou e por quê.

## Escopo
- comportamento novo/alterado;
- o que ficou explicitamente fora de escopo.

## Implementação
- decisões importantes;
- frontend/backend/contratos/dados afetados.

## Segurança e invariantes
- autorização;
- operações destrutivas;
- filesystem/SSRF/segredos quando aplicável.

## UX
- desktop/mobile;
- loading/error/empty;
- acessibilidade relevante.

## Testes
- comandos/suítes executados;
- regressões adicionadas.

## Documentação / issues
- docs atualizados;
- issue(s) relacionadas.

## Gate
- auto code review final;
- CI verde no head final;
- zero blocker/high/medium pendente.
```

### PR de UI

Além do texto, revisar explicitamente:

- desktop/tablet/mobile;
- overflow;
- estados longos/vazios/erro;
- foco/teclado;
- ações destrutivas;
- coerência com o padrão visual atual.

### PR de segurança/filesystem/importação

Documentar invariantes preservadas e testes negativos relevantes.

---

## 13. Issues, roadmap e documentação

Quando uma entrega muda o estado do produto:

- atualizar o documento funcional correspondente;
- atualizar `docs/roadmap.md` quando muda uma fase/pendência;
- atualizar o índice executivo vigente quando existir um ciclo de backlog ativo; a #123 preserva o ciclo encerrado em 2026-09-02 e não deve ser reaberta artificialmente para novas atividades;
- fechar issue somente quando o escopo foi realmente entregue;
- não deixar issue/documento dizendo “planejado” para algo já em `main`;
- não marcar item como concluído apenas porque parte dele existe.

`docs/README.md` explica quais documentos são canônicos e quais preservam histórico.

---

## 14. CI e merge

CI válido é o CI do **commit final que será mergeado**.

Se um commit for adicionado depois de um CI verde, aguarde/execute novamente o pipeline apropriado.

Antes do merge, confirmar:

- branch atualizada o suficiente para detectar conflito relevante;
- auto code review final concluído;
- zero BLOCKER/HIGH/MEDIUM pendente;
- typecheck e regressões de segurança verdes;
- testes funcionais verdes;
- benchmark de biblioteca grande verde quando o gate existir no workflow;
- build e validações operacionais relevantes verdes;
- smoke de produção verde quando aplicável;
- E2E/Playwright verde para mudança de fluxo/UI quando aplicável;
- documentação/issues coerentes;
- PR descreve o head final.

Só então emitir:

```text
VERDICT: APPROVE / MERGE
```

Caso contrário:

```text
VERDICT: BLOCK
```

com os findings concretos.

---

## 15. Depois do merge

Quando a mudança exige atualização da instalação local/produção, fornecer comandos exatos.

Fluxo normal do Home Music:

```bash
git switch main
git pull --ff-only origin main
npm run service:update
```

Depois validar:

```bash
npm run service:status
curl -i http://127.0.0.1:8787/ready
```

Não sugerir recriar `.env` em instalações existentes. Mudanças de configuração devem ser apresentadas explicitamente e com cuidado para não perder credenciais/paths locais.

---

## 16. Regra final

O agente deve otimizar para **correção e manutenção**, não para velocidade aparente.

Uma tarefa só termina quando:

```text
implementação correta
+ segurança preservada
+ UX coerente
+ testes adequados
+ docs/issues sincronizados
+ auto code review completo no head final
+ CI final verde
= pronta para merge
```
