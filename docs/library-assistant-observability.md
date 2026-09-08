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
- `rateLimitWaitMs` — tempo acumulado aguardando a janela de rate limit;
- `retriesTotal` — transições persistidas para `retry`;
- `retriesByReason` — retries agrupados pelo código sanitizado da falha.

A UI administrativa resume vazão, ETA, consultas externas, percentual atendido por cache, espera de rate limit e retries junto ao progresso da análise.

## Atribuição e segurança

As consultas são atribuídas ao run usando o mesmo `AbortSignal` já propagado pelo `LibraryAssistantService` até o analyzer e o gateway. Não é criado estado global de “run atual”, portanto runs distintos não compartilham contadores por acidente.

O coletor é derivado e best-effort: falha ao registrar uma métrica nunca pode alterar consulta, cache, fila ou resultado da análise. Códigos de retry são normalizados antes de entrar na agregação e nenhum payload, termo de busca, path físico ou segredo é exposto nas métricas.

## Persistência e restart

Os contadores detalhados de provider/retry ficam em memória e são limitados aos runs mais recentes. Em um restart do servidor, uma fila persistente pode retomar o run, mas os contadores detalhados reiniciam; os contadores canônicos da fila e o tempo do run continuam vindo do estado persistido.

Essa escolha é intencional nesta primeira etapa: observabilidade não ganha uma nova tabela nem vira autoridade de domínio. Se a baseline mostrar necessidade de histórico comparável entre restarts, a persistência das métricas deve ser tratada em mudança separada.

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

Com essa baseline, a etapa seguinte deve atacar o maior desperdício observado — por exemplo, reduzir buscas progressivas quando a primeira já for suficiente ou corrigir retries transitórios excessivos — sem reduzir o rate limit por tentativa e erro.
