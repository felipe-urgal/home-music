# Observabilidade de jobs longos

Este documento define a observabilidade de runtime para operações longas do Home Music e a fronteira entre **logs estruturados** e o **Histórico operacional persistido**.

A baseline foi introduzida na Fase 11 pela issue #121.

## Fonte de verdade

A camada de logs **não substitui estado de produto**.

- scans manuais/automáticos e importações continuam persistidos em **Administração → Histórico operacional**;
- `ImportJobQueue` continua sendo a autoridade da máquina de estados de importação em runtime;
- `LibraryService` continua sendo a autoridade da execução de scan;
- `TranscodeManager` continua sendo a autoridade de jobs de transcoding/cache;
- logs estruturados existem para correlação temporal e diagnóstico operacional no servidor.

Não criar tabela paralela, fila paralela ou painel separado apenas para reproduzir esses estados.

## Eventos

O logger do Fastify/Pino emite eventos de lifecycle com o campo `event`:

```text
long_job.started
long_job.completed
long_job.failed
long_job.cancelled
```

Eventos terminais incluem `durationMs`.

Campos de correlação possíveis:

- `jobType` — `library.scan`, `import` ou `transcode`;
- `jobId` — identificador interno do job observado;
- `operationId` — identificador do Histórico operacional quando existe uma correlação persistida;
- `resourceId` — identificador interno seguro de um recurso quando necessário para diagnóstico; atualmente usado por transcode para a faixa;
- `requestId` — ID interno que o Fastify atribuiu à requisição HTTP que originou a transição, quando existe uma requisição ativa.

Os IDs aceitos pela camada de observabilidade são restritos a caracteres de identificador. Strings parecidas com URL/path não são reutilizadas como ID de log.

## Correlação HTTP

`LongJobObservability` usa `AsyncLocalStorage` somente para carregar o `requestId` interno do Fastify através da cadeia assíncrona da requisição. O contexto é iniciado em `preValidation`, depois do parsing do request e antes do handler.

Isso permite a cadeia de diagnóstico:

```text
requestId do Fastify
  ↓
jobId do serviço/fila
  ↓
operationId do Histórico, quando existe
```

Scans manuais, importações iniciadas/continuadas por API e transcodes podem carregar `requestId`. Scheduler, bootstrap e trabalhos que realmente nascem fora de uma requisição não recebem um request artificial.

O contexto não armazena usuário, sessão, cookie, token, URL ou payload. Jobs que continuam em uma cadeia assíncrona criada pela requisição podem preservar aquele `requestId`; uma transição posterior causada por outra requisição pode naturalmente aparecer com o novo `requestId`. O `jobId` continua sendo o elo estável entre as transições.

A regressão automatizada usa Fastify real com `inject()` e requests concorrentes para provar que o contexto chega ao handler sem cruzar IDs entre requisições.

## Scans

### Manual e automático

Scans iniciados com trigger administrativo já criam um registro no Histórico. O mesmo ID é usado como:

```text
jobId       = scan-...
operationId = scan-...
jobType     = library.scan
```

Assim, o operador pode abrir uma operação na UI e procurar o mesmo `operationId` no journal. Quando o scan foi iniciado pela API, o lifecycle também carrega o `requestId` do Fastify.

A falha de persistência do Histórico continua best-effort: o scan principal não falha por isso. Se o registro persistido não puder ser criado, o log recebe um `jobId` gerado apenas para runtime e omite `operationId`.

### Bootstrap

O scan de bootstrap necessário para inicializar uma biblioteca sem snapshot válido continua **fora do Histórico administrativo**, como já era o contrato do produto.

Ele recebe eventos de runtime com:

```text
jobType = library.scan
jobId   = library-scan-...
```

Não há `operationId`, porque não existe uma operação administrativa persistida para correlacionar. Como o bootstrap nasce fora de request, também não há `requestId`.

Chamadas concorrentes que reutilizam a mesma `scanPromise` não criam jobs de scan adicionais.

## Importações

O `jobId` já existente na `ImportJobQueue` é reutilizado.

Quando o snapshot do job é persistido com sucesso no Histórico:

```text
jobId       = <id da ImportJobQueue>
operationId = import-<jobId>
jobType     = import
```

O primeiro ingresso em `processing` emite `long_job.started`. Uma importação que volta temporariamente para `pending` e depois retoma `processing` preserva `startedAt` e **não emite um segundo início**.

Estados terminais emitem:

- `completed` → `long_job.completed`;
- `failed` → `long_job.failed`;
- `cancelled` → `long_job.cancelled`.

Transições disparadas dentro de uma requisição também carregam `requestId`. O ID não é persistido dentro do `ImportJob`: ele é apenas contexto de logging e não altera o contrato compartilhado ou a máquina de estados.

Se a persistência do Histórico falhar, o evento de runtime ainda pode usar `jobId`, mas omite `operationId`; isso evita afirmar correlação com um registro inexistente.

## Transcoding

Transcodes adaptativos não fazem parte do Histórico administrativo persistido e continuam runtime-only.

Um job estruturado só é criado quando o `TranscodeManager` realmente precisa gerar um arquivo novo. Os seguintes caminhos **não** criam lifecycle adicional:

- cache hit já existente;
- segundo consumidor aguardando um transcode concorrente já deduplicado;
- cache preenchido por outro job enquanto o worker aguardava slot.

Quando há geração real:

```text
jobType    = transcode
jobId      = transcode-<uuid>
resourceId = <trackId interno>
requestId  = <id Fastify da chamada /transcode>, quando originado por HTTP
```

Nenhum path do arquivo de origem/cache e nenhum stderr bruto do FFmpeg entra nos novos bindings de observabilidade.

## Privacidade e redaction

Falhas usam a mesma `sanitizeOperationError` do Histórico operacional antes de entrar em um evento `long_job.failed`.

Os novos eventos não registram deliberadamente:

- senha;
- cookie;
- token/secret/API key;
- header Authorization/Bearer;
- URL original de importação;
- path físico da biblioteca, staging ou cache;
- label livre de importação;
- stack trace;
- objeto `err` bruto;
- stderr bruto do FFmpeg.

`requestId`, `jobId`, `operationId` e `resourceId` são identificadores internos limitados e não carregam esses payloads sensíveis.

A sanitização conhecida substitui URLs e paths e limita o tamanho do diagnóstico. Logs antigos fora desta camada continuam sujeitos às regras próprias do fluxo correspondente; novas instrumentações de job longo devem usar esta camada em vez de adicionar `err` bruto ao evento de lifecycle.

## Best-effort

Observabilidade não faz parte do commit lógico do job.

Se o sink de logging lançar uma exceção, `LongJobObservability` a absorve. O resultado do scan/import/transcode continua determinado exclusivamente pela operação principal.

Da mesma forma, a falha do Histórico não deve derrubar scan/importação; essa separação já existia e é preservada.

## Volume e retenção

A camada registra apenas transições relevantes de lifecycle. Não existe heartbeat periódico nem evento por percentual/progresso fino.

Isso mantém volume proporcional ao número real de operações longas.

A retenção dos logs de runtime é a retenção configurada para o `journald`/ambiente onde o processo roda. A #121 **não cria retenção própria em SQLite** para os eventos de log.

O Histórico operacional mantém sua retenção persistida independente, conforme [`admin-operation-history.md`](admin-operation-history.md).

## Investigação em produção

O serviço systemd já centraliza stdout/stderr no journal.

### Ver jobs longos recentes

```bash
journalctl -u home-music --since "1 hour ago" -o cat | grep '"event":"long_job\.'
```

### Procurar uma operação aberta no Histórico

Copie o `operationId` exibido/identificado no Histórico e procure no journal:

```bash
journalctl -u home-music --since today -o cat | grep '"operationId":"scan-SEU_ID"'
```

Para importação:

```bash
journalctl -u home-music --since today -o cat | grep '"operationId":"import-SEU_JOB_ID"'
```

### Procurar pelo job de runtime

```bash
journalctl -u home-music --since today -o cat | grep '"jobId":"SEU_JOB_ID"'
```

### Correlacionar com uma requisição Fastify

Quando um log de request do Fastify fornece o `reqId`, procure o mesmo valor nos jobs:

```bash
journalctl -u home-music --since today -o cat | grep '"requestId":"req-SEU_ID"'
```

Para transcodes, comece pelos eventos `jobType="transcode"` e use `jobId`/`resourceId` internos. Não procure por path físico da faixa: ele não é necessário nem deve fazer parte do evento estruturado.

### Interpretar duração

`durationMs` mede a janela conhecida do lifecycle:

- scan/transcode: do início observado ao término;
- importação: de `startedAt` (ou `createdAt` quando falha antes de iniciar processamento) até `finishedAt`, seguindo a semântica já usada pelo Histórico.

Importações podem aguardar interação administrativa entre etapas; portanto duração longa não significa, isoladamente, CPU/IO ocupado por todo o período.

## Relação com health/runtime

Os eventos não substituem endpoints de health/readiness.

O estado agregado de transcoding (`active`/`pending`) continua exposto pelo diagnóstico já existente. Use health para responder “como está agora?” e os eventos correlacionados para responder “o que aconteceu com este job?”.

## Testes

Cobertura automatizada fixa:

- início/conclusão e duração;
- propagação/isolamento de `requestId` em contexto assíncrono;
- integração do contexto com `preValidation` real do Fastify via `inject()` concorrente;
- redaction de erro antes do log;
- ausência de `err` bruto no evento de falha;
- logging best-effort que não derruba o job;
- correlação de scan com `operationId`;
- correlação e deduplicação do lifecycle de importação;
- transcode observado somente na geração real, sem novo lifecycle em cache hit.

## Regra para novas operações longas

Ao instrumentar um novo pipeline:

1. identifique primeiro a fonte de verdade já existente;
2. reutilize o `jobId`/`operationId` canônico quando houver;
3. use `LongJobObservability` para lifecycle de runtime;
4. preserve `requestId` somente como contexto de correlação, nunca como estado de domínio;
5. não passe payload livre, URL, path ou erro bruto como binding;
6. prefira eventos de transição a heartbeats frequentes;
7. teste sucesso, falha/redaction, request-context quando aplicável e best-effort;
8. só adicione persistência/UI se existir requisito de produto que o Histórico atual não cubra.
