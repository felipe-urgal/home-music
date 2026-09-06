# Assistente da Biblioteca

## Estado

A fundação do **Assistente da Biblioteca** foi implementada pela Fase 15 / #311. Ela entrega contratos, persistência auditável, stale protection, lifecycle administrativo e infraestrutura segura para providers. As integrações reais de MusicBrainz, Cover Art Archive, lyrics, fingerprint e aplicação de sugestões continuam em issues posteriores.

A fundação é deliberadamente **read-only em relação às autoridades efetivas da biblioteca**: iniciar uma análise pode criar runs, sugestões e cache derivado do Assistente, mas não altera metadata, capa, letra ou arquivo de áudio.

## Autoridades preservadas

O Assistente é um orquestrador. A fonte de verdade continua sendo composta pelas autoridades já existentes:

- `MUSIC_DIR` + scanner para estado físico;
- `LibraryService` para snapshot base e revision;
- a projeção administrativa existente para metadata override, normalização, cover override e respectivas revisions;
- `TrackMetadataOverrideStore` para correções textuais efetivas;
- `TrackCoverOverrideStore` para capa efetiva;
- normalização/aliases existentes;
- pipeline canônico de lyrics para letra publicada.

`library_assistant_*` nunca é um segundo catálogo de `tracks`.

## Contratos compartilhados

Os contratos que cruzam web/server vivem em `@home-music/shared/library-assistant` e possuem versão explícita.

A fundação define:

- `LibraryAssistantRun`;
- capabilities `metadata`, `artwork` e `lyrics`;
- status de run `queued`, `running`, `completed`, `failed`, `cancelled` e `stale`;
- `LibraryAssistantSuggestion` e seus status;
- confidence bands `low`, `medium` e `high`;
- reason codes estáveis;
- evidências tipadas/versionadas;
- proveniência normalizada;
- targets tipados por capability;
- resumo de contagens do run.

Evidência crítica não usa `Record<string, unknown>` como contrato de domínio. Payload externo precisa ser normalizado antes de virar evidência/sugestão persistível.

## Persistência

`LibraryAssistantStore` usa **o mesmo arquivo SQLite** da aplicação, seguindo o padrão de stores especializados existentes. Ele cria somente estado derivado/auditável:

- `library_assistant_runs`;
- `library_assistant_suggestions`;
- `library_assistant_provider_cache`.

Não existe cópia canônica da tabela `tracks`.

### Retenção e limites

- runs terminais: retenção padrão limitada a 200;
- sugestões por run: no máximo 500 na fundação;
- evidências por sugestão: no máximo 32;
- payload persistido de sugestão: no máximo 64 KiB;
- cache normalizado de provider: no máximo 500 entradas;
- payload normalizado de cache: no máximo 64 KiB;
- TTL máximo de cache: 30 dias.

Runs `queued`/`running` encontrados após restart são marcados como `failed/interrupted`. Sugestões ainda abertas desses runs são invalidadas, evitando reutilização de estado parcial.

## Snapshot e stale protection

Ao iniciar um run, `LibraryAssistantService` captura:

1. a biblioteca efetiva projetada;
2. a revision efetiva correspondente.

A projeção é a mesma autoridade usada pela entrega da biblioteca e incorpora mudanças de metadata override, normalização, cover override e arquivo, além da revision base do `LibraryService`.

Cada sugestão armazena uma assinatura SHA-256 da **premissa relevante**, não um path físico ou detalhe frágil do SQLite. A assinatura varia conforme a capability, por exemplo:

- metadata/lyrics: identidade lógica, título, artista, álbum, `albumArtist` e duração;
- artwork: identidade lógica, metadata relevante, `hasCover` e `coverVersion`.

Se a revision mudar durante a análise, o run se torna `stale`. Para um run já concluído, a leitura revalida as premissas das sugestões; uma sugestão cuja faixa desapareceu ou cuja premissa mudou vira `stale` antes de qualquer aplicação futura.

Cancelamento, falha e shutdown também invalidam sugestões parciais ainda em `pending/review`.

## Execução e backpressure

A fundação não cria worker/fila paralela.

`LibraryAssistantService` reutiliza a `HeavyWorkQueue` existente e o contexto de owner. Na composição inicial, o Assistente compartilha a fila usada por integridade, mantendo backpressure e fairness no mesmo mecanismo já operado pelo servidor.

O lifecycle também reutiliza `LongJobObservability` com `jobType = library.assistant`.

No shutdown:

1. controllers ativos são abortados;
2. promises agendadas são aguardadas com `Promise.allSettled`;
3. somente depois o store do Assistente é fechado.

Isso evita trabalho assíncrono persistindo depois do fechamento do SQLite.

## Gateway de providers

A #311 entrega somente a infraestrutura; **não integra provider real**.

`LibraryAssistantProviderGateway` oferece:

- cache derivado por provider + versão + SHA-256 da chave lógica;
- nenhuma chave bruta com token/cookie/secret persistida;
- TTL/versionamento;
- deduplicação de consultas equivalentes em voo;
- rate limit por provider;
- timeout;
- `AbortSignal` durante espera de rate-limit e execução;
- User-Agent obrigatório/validado;
- normalização antes de persistir cache;
- falha de cache degradando para consulta normal, sem afetar a biblioteca.

Respostas malformadas são rejeitadas antes de entrar no contrato interno. CI/testes usam providers fake; a fundação não depende de internet pública.

## API administrativa

Todas as rotas vivem sob `/api/admin/library-assistant` e portanto usam a política central de autenticação administrativa.

### Iniciar análise

`POST /api/admin/library-assistant/runs`

Body:

```json
{ "capability": "metadata" }
```

Retorna `202` com o run criado. Como é mutação de lifecycle, exige o header já canônico:

```text
X-Home-Music-Request: 1
```

### Listar runs

`GET /api/admin/library-assistant/runs?limit=50`

Limite aceito: 1–200.

### Consultar run

`GET /api/admin/library-assistant/runs/:id`

### Listar sugestões

`GET /api/admin/library-assistant/runs/:id/suggestions?status=review&limit=200`

Limite aceito: 1–500.

### Cancelar

`POST /api/admin/library-assistant/runs/:id/cancel`

Também exige `X-Home-Music-Request: 1`.

### O que não existe nesta fase

Não existe endpoint `apply`. A #311 não altera metadata/capa/lyrics efetivos e não escreve tags/arquivos.

## Segurança e privacidade

A fundação aplica as seguintes fronteiras:

- admin-only por política central `/api/admin/*`;
- anti-CSRF já existente nas mutações de lifecycle;
- IDs/limites defensivos nas rotas;
- evidência `file-context` aceita somente nome de arquivo/pasta, nunca path;
- paths físicos não entram nas respostas do Assistente;
- cache usa hash da chave lógica, não a chave bruta;
- secrets, cookies, Authorization e API keys não fazem parte dos contratos;
- erro de run passa pela sanitização operacional existente;
- payload bruto arbitrário de provider não é persistido como auditoria;
- observabilidade usa IDs internos e erro sanitizado, não `err` bruto.

## Testes da fundação

A cobertura automatizada inclui:

- contratos tipados e typecheck shared/server;
- persistência e reopen SQLite;
- recuperação após restart;
- stale por mudança da premissa/revision;
- ausência de mutação da biblioteca efetiva/tabela `tracks`;
- cancelamento com sugestão parcial;
- duas análises concorrentes do mesmo snapshot;
- cache versionado/TTL;
- deduplicação de consulta;
- rate limit e cancelamento durante a espera;
- timeout e cancelamento durante provider;
- payload malformado;
- rejeição de chave sensível/path e limites de payload;
- 401/403 e anti-CSRF na API;
- ausência de endpoint de aplicação.

## Próximos módulos

Com esta fundação estabilizada, as próximas entregas devem adicionar analyzers concretos sem duplicar lifecycle, cache ou modelo de sugestão. A ordem primária do roadmap é:

- #312 — identificação de metadata com MusicBrainz e matching explicável;
- #313 — revisão/aplicação segura das sugestões de metadata;
- #314/#315 e demais capacidades depois que o fluxo base estiver provado.

O plano amplo continua em [`library-assistant-plan.md`](library-assistant-plan.md), mas este documento descreve o **comportamento já implementado da fundação**.
