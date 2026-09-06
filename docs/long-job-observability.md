# Observabilidade de jobs longos

Este documento define a observabilidade de runtime para operações longas do Home Music e a fronteira entre **logs estruturados** e estado persistido de domínio.

## Fonte de verdade

A camada de logs **não substitui estado de produto**.

- scans manuais/automáticos e importações continuam persistidos em **Administração → Histórico operacional**;
- `ImportJobQueue` continua sendo a autoridade da máquina de estados de importação em runtime;
- `LibraryService` continua sendo a autoridade da execução de scan;
- `LibraryAssistantStore` continua sendo a autoridade persistida dos runs/sugestões do Assistente;
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

Eventos terminais incluem `durationMs`. Quando a operação já produz contagens numéricas seguras e úteis, o evento terminal pode repetir essas métricas como snapshot de diagnóstico. A camada não aceita payload arbitrário para esse fim.

Campos de correlação possíveis:

- `jobType` — `library.scan`, `library.assistant`, `import` ou `transcode`;
- `jobId` — identificador interno do job observado;
- `operationId` — identificador do Histórico operacional quando existe uma correlação persistida;
- `resourceId` — identificador interno seguro de um recurso/capability quando necessário;
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

Scans manuais, runs do Assistente iniciados por API, importações e transcodes podem carregar `requestId`. Scheduler, bootstrap e trabalhos que realmente nascem fora de uma requisição não recebem um request artificial.

O contexto não armazena usuário, sessão, cookie, token, URL ou payload. O `jobId` continua sendo o elo estável entre as transições.

## Scans

Scans iniciados com trigger administrativo já criam um registro no Histórico. O mesmo ID é usado como `jobId` e `operationId`, com `jobType = library.scan`.

Em conclusão bem-sucedida, `long_job.completed` pode incluir `tracks`, `added`, `updated`, `removed` e `unchanged`. Elas são convenientes para diagnóstico no journal, mas o Histórico/resultado do scan continua sendo a fonte persistente do estado.

O scan de bootstrap necessário para inicializar uma biblioteca sem snapshot válido continua fora do Histórico administrativo e usa somente lifecycle de runtime.

## Assistente da Biblioteca

Runs do Assistente possuem persistência própria e auditável em `LibraryAssistantStore`. `LongJobObservability` apenas espelha o lifecycle de runtime:

```text
jobType    = library.assistant
jobId      = <id do LibraryAssistantRun>
resourceId = metadata | artwork | lyrics
requestId  = <id Fastify da chamada de start>, quando aplicável
```

Não existe `operationId`, porque #311 não duplica os runs do Assistente no Histórico operacional.

O lifecycle observado é:

- início real do worker → `long_job.started`;
- conclusão → `long_job.completed`;
- cancelamento → `long_job.cancelled`;
- falha ou stale detectado durante execução → `long_job.failed` com erro sanitizado.

A fonte de verdade do status continua sendo o run persistido. Um evento de observabilidade nunca muda `queued/running/completed/failed/cancelled/stale`.

A observabilidade do Assistente não inclui:

- evidências completas;
- candidates/targets;
- resposta bruta de provider;
- cache key lógica;
- path físico;
- metadata textual da faixa;
- token/cookie/User-Agent externo.

No shutdown, o `LibraryAssistantService` aborta os controllers e aguarda as promises agendadas antes do fechamento do store. O evento observado permanece best-effort e não participa da transação SQLite.

## Importações

O `jobId` já existente na `ImportJobQueue` é reutilizado. Quando o snapshot do job é persistido com sucesso no Histórico:

```text
jobId       = <id da ImportJobQueue>
operationId = import-<jobId>
jobType     = import
```

O primeiro ingresso em `processing` emite `long_job.started`. Estados terminais emitem `completed`, `failed` ou `cancelled` conforme a máquina de estados existente.

Se a persistência do Histórico falhar, o evento de runtime ainda pode usar `jobId`, mas omite `operationId`; isso evita afirmar correlação com um registro inexistente.

## Transcoding

Transcodes adaptativos não fazem parte do Histórico administrativo persistido e continuam runtime-only.

Um job estruturado só é criado quando o `TranscodeManager` realmente precisa gerar um arquivo novo. Cache hit, segundo consumidor aguardando trabalho deduplicado e cache preenchido por outro worker não criam lifecycle adicional.

Quando há geração real:

```text
jobType    = transcode
jobId      = transcode-<uuid>
resourceId = <trackId interno>
requestId  = <id Fastify>, quando originado por HTTP
```

Nenhum path do arquivo de origem/cache e nenhum stderr bruto do FFmpeg entra nos bindings de observabilidade.

## Privacidade e redaction

Falhas usam `sanitizeOperationError` antes de entrar em `long_job.failed`.

Os eventos não registram deliberadamente:

- senha;
- cookie;
- token/secret/API key;
- header Authorization/Bearer;
- URL original de importação;
- path físico da biblioteca, staging ou cache;
- payload/evidência de provider do Assistente;
- label livre sensível;
- stack trace;
- objeto `err` bruto;
- stderr bruto do FFmpeg.

`requestId`, `jobId`, `operationId` e `resourceId` são identificadores internos limitados. Métricas adicionais são somente números explicitamente tipados.

## Best-effort

Observabilidade não faz parte do commit lógico do job.

Se o sink de logging lançar uma exceção, `LongJobObservability` a absorve. O resultado do scan/Assistente/import/transcode continua determinado exclusivamente pela operação principal e por sua fonte de verdade.

## Volume e retenção

A camada registra apenas transições relevantes de lifecycle. Não existe heartbeat periódico nem evento por percentual/progresso fino.

A retenção dos logs de runtime é a retenção configurada para o `journald`/ambiente onde o processo roda. `LongJobObservability` não cria retenção própria em SQLite.

Estados persistidos continuam com as retenções de seus domínios: Histórico operacional para scan/importação e `LibraryAssistantStore` para runs/sugestões do Assistente.

## Investigação em produção

### Ver jobs longos recentes

```bash
journalctl -u home-music --since "1 hour ago" -o cat | grep '"event":"long_job\.'
```

### Assistente

```bash
journalctl -u home-music --since today -o cat | grep '"jobType":"library.assistant"'
```

Use o `jobId` para correlacionar com o run administrativo. Não procure por título/path da faixa: esses dados não fazem parte do evento.

### Scan/importação

Quando houver `operationId`, ele pode ser procurado no journal:

```bash
journalctl -u home-music --since today -o cat | grep '"operationId":"SEU_ID"'
```

### Request Fastify

```bash
journalctl -u home-music --since today -o cat | grep '"requestId":"req-SEU_ID"'
```

## Relação com health/runtime

Os eventos não substituem endpoints de health/readiness. Use health/runtime para responder “como está agora?” e os eventos correlacionados para responder “o que aconteceu com este job?”.

## Testes

A cobertura automatizada da camada e dos consumidores fixa:

- início/conclusão, duração e métricas tipadas;
- propagação/isolamento de `requestId`;
- redaction de erro antes do log;
- ausência de `err` bruto;
- logging best-effort;
- correlação do scan/importação;
- transcode observado somente na geração real;
- `library.assistant` como job type conhecido, com lifecycle coordenado pelo `LibraryAssistantService`.

## Regra para novas operações longas

Ao instrumentar um novo pipeline:

1. identifique primeiro a fonte de verdade já existente;
2. reutilize `jobId`/`operationId` canônico quando houver;
3. use `LongJobObservability` somente para lifecycle de runtime;
4. preserve `requestId` apenas como contexto de correlação;
5. não passe payload livre, URL, path ou erro bruto como binding;
6. prefira métricas numéricas explicitamente tipadas;
7. prefira eventos de transição a heartbeats;
8. teste sucesso, falha/redaction, request-context e best-effort;
9. só adicione persistência/UI se existir requisito de produto que a autoridade atual não cubra.
