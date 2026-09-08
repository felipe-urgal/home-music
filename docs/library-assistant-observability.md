# Observabilidade da análise da biblioteca

Este documento descreve as métricas operacionais expostas pelo Assistente da Biblioteca para medir o custo real de uma análise antes de otimizar o algoritmo do MusicBrainz.

## Objetivo

A primeira etapa de otimização não altera matching, ordem de buscas, concorrência, política de retry nem o intervalo de rate limit do provider. Ela apenas mede o caminho atual para responder com dados reais:

- quantas consultas ao gateway foram necessárias;
- quantas consultas chegaram ao provider externo;
- quantas respostas vieram do cache;
- quanto tempo foi gasto aguardando o rate limit;
- quantos retries foram agendados e por qual motivo;
- qual a vazão observada em faixas por segundo;
- qual o tempo estimado restante do run.

## Contrato de progresso

`GET /api/admin/library-assistant/runs/:id/progress` continua retornando os contadores da fila e pode incluir `progress.metrics` com:

- `elapsedMs` — tempo de parede desde o início do run;
- `tracksPerSecond` — faixas terminadas por segundo usando o tempo de parede;
- `etaMs` — estimativa simples para os itens restantes; `null` enquanto ainda não existe vazão suficiente;
- `searchAttempts` — operações do gateway observadas para o run;
- `externalRequests` — operações que realmente chegaram ao provider externo;
- `cacheHits` / `cacheMisses` — resultado do cache do gateway;
- `rateLimitWaitMs` — tempo acumulado aguardando a janela de rate limit, incluindo cooldown do provider;
- `retriesTotal` — transições persistidas para `retry`;
- `retriesByReason` — retries agrupados pelo código sanitizado da falha.

A UI administrativa resume vazão, ETA, consultas externas, percentual atendido por cache, espera de rate limit e retries junto ao progresso da análise.

## Atribuição e segurança

As consultas são atribuídas ao run usando o mesmo `AbortSignal` já propagado pelo `LibraryAssistantService` até o analyzer e o gateway. Não é criado estado global de “run atual”, portanto runs distintos não compartilham contadores por acidente.

O coletor é derivado e best-effort: falha ao registrar uma métrica nunca pode alterar consulta, cache, fila ou resultado da análise. Códigos de retry são normalizados antes de entrar na agregação e nenhum payload, termo de busca, path físico ou segredo é exposto nas métricas.

## Persistência e restart

Os contadores detalhados de provider/retry ficam em memória e são limitados aos runs mais recentes. Em um restart do servidor, uma fila persistente pode retomar o run, mas os contadores detalhados reiniciam; os contadores canônicos da fila e o tempo do run continuam vindo do estado persistido.

Essa escolha é intencional nesta primeira etapa: observabilidade não ganha uma nova tabela nem vira autoridade de domínio. Se a baseline mostrar necessidade de histórico comparável entre restarts, a persistência das métricas deve ser tratada em mudança separada.

## Proteção contra pressão do MusicBrainz

A baseline real mostrou que retries de provider podem dominar o tempo total. Por isso, o caminho de produção do MusicBrainz distingue agora:

- HTTP `429` como `provider-rate-limited`;
- HTTP `503` como `provider-unavailable`.

Quando uma dessas respostas ocorre, o gateway aplica um cooldown compartilhado ao provider em vez de deixar apenas a faixa atual entrar em retry. O cooldown:

- respeita `Retry-After` em segundos ou HTTP-date quando o MusicBrainz o fornece;
- usa backoff adaptativo conservador de 5 s, 10 s, 20 s, 40 s e até 60 s quando o provider continua recusando consultas;
- mantém o intervalo normal de 1 requisição/segundo entre slots;
- evita uma rajada de consultas logo após o cooldown ao reagendar os slots pendentes;
- volta ao comportamento normal após uma consulta externa bem-sucedida.

`Retry-After` é limitado a no máximo 2 horas para impedir que um header externo inválido paralise o processo indefinidamente. O algoritmo de matching e a política persistida de retry por faixa permanecem inalterados.

## Redução de consultas duplicadas

Depois do cooldown, uma nova baseline chegou a 400 de 1.328 faixas com 726 consultas externas, 160 retries e cerca de 26 minutos acumulados aguardando rate limit/cooldown. O próximo desperdício ficou no volume de consultas.

O analyzer agora usa uma única identidade externa por `title + artist`. Álbum continua participando do ranking local, escolha de release e contexto coletivo, mas não cria uma segunda chamada. A chave de cache usa exatamente a mesma identidade da consulta externa, evitando que uma resposta vazia seja repetida sob outra chave e permitindo reutilização entre faixas equivalentes em álbuns diferentes.

Essa mudança não aumenta concorrência, não reduz o intervalo de 1 requisição/segundo e não afrouxa o cooldown. O ganho esperado vem somente de fazer menos trabalho externo.

## Como usar a baseline

Para comparar uma execução real, registrar ao final pelo menos:

```text
faixas totais
tempo total
faixas/s
searchAttempts
externalRequests
cacheHits / cacheMisses
rateLimitWaitMs
retriesTotal + retriesByReason
matched / noMatch / failed
```

Na próxima execução, o principal comparativo é `externalRequests / faixas processadas`, junto com `rateLimitWaitMs`, retries e vazão. Novas otimizações só devem ser consideradas depois de medir esse resultado, sem reduzir o rate limit por tentativa e erro.
