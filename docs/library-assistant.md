# Assistente da Biblioteca

## Estado

A Fase 15 possui duas camadas implementadas:

- **#311 — fundação:** contratos, runs, sugestões, persistência auditável, stale protection, lifecycle administrativo, fila/observabilidade e gateway seguro de providers;
- **#312 — identificação de metadata:** primeiro analyzer real, usando contexto local + MusicBrainz para produzir sugestões explicáveis de `title`, `artist`, `album` e `albumArtist`.

O Assistente continua **read-only em relação às autoridades efetivas da biblioteca**. Uma análise pode criar runs, sugestões e cache derivado, mas não altera metadata efetiva, cover override, tags, lyrics nem arquivos. Aplicação de sugestões pertence à #313.

## Autoridades preservadas

O Assistente é um orquestrador, não um segundo catálogo. As fontes de verdade continuam sendo:

- `MUSIC_DIR` + scanner para estado físico;
- `LibraryService` para snapshot base e revision;
- projeção administrativa para metadata/aliases/cover override;
- `TrackMetadataOverrideStore` para decisões humanas de metadata;
- `TrackCoverOverrideStore` para capa efetiva;
- domínio canônico de lyrics para letra publicada.

As tabelas `library_assistant_*` guardam somente estado derivado/auditável e nunca substituem `tracks`.

## Contratos compartilhados

Os contratos que cruzam web/server vivem em `@home-music/shared/library-assistant` e possuem versão explícita. Eles definem:

- capabilities `metadata`, `artwork` e `lyrics`;
- lifecycle de run (`queued`, `running`, `completed`, `failed`, `cancelled`, `stale`);
- sugestões e status;
- confidence bands `low`, `medium`, `high`;
- reason codes estáveis;
- evidências tipadas/versionadas;
- proveniência e IDs externos tipados;
- targets por capability.

Payload externo arbitrário nunca vira regra de domínio. O MusicBrainz é normalizado antes de entrar no cache ou nas sugestões.

## Persistência, snapshot e stale protection

`LibraryAssistantStore` usa o mesmo SQLite da aplicação e mantém:

- `library_assistant_runs`;
- `library_assistant_suggestions`;
- `library_assistant_provider_cache`.

Limites atuais:

- até 200 runs terminais retidos por padrão;
- até 500 sugestões por run;
- até 32 evidências por sugestão;
- até 64 KiB de payload persistido por sugestão/cache;
- até 500 entradas de cache de provider;
- TTL máximo global do gateway: 30 dias.

Ao iniciar um run, `LibraryAssistantService` captura a biblioteca efetiva projetada e sua revision. Cada sugestão recebe assinatura SHA-256 da premissa relevante. Mudança de revision/premissa torna o run ou a sugestão `stale` antes de qualquer aplicação futura.

Runs encontrados em `queued/running` após restart viram `failed/interrupted`; cancelamento, falha e shutdown invalidam sugestões parciais ainda abertas.

## Execução e backpressure

O Assistente reutiliza `HeavyWorkQueue` e `LongJobObservability`; não cria uma segunda fila. O shutdown aborta controllers ativos, aguarda o trabalho agendado e somente depois fecha o store.

## Gateway de providers

`LibraryAssistantProviderGateway` é a fronteira única para providers do Assistente. Ele oferece:

- cache derivado por provider + versão + SHA-256 da chave lógica;
- deduplicação de consultas equivalentes em voo;
- rate limit central por provider;
- timeout e `AbortSignal`;
- User-Agent obrigatório/validado;
- normalização antes de persistir cache;
- invalidação segura de cache malformado;
- degradação para consulta live quando o cache derivado falha.

Secrets, cookies, Authorization, API keys e paths físicos não entram nas chaves persistidas.

## Analyzer de metadata / MusicBrainz (#312)

### Papel do provider

MusicBrainz é **evidência externa**, nunca autoridade física e nunca justificativa isolada para mutação automática. O analyzer usa somente o endpoint canônico WS2 de recording search:

```text
https://musicbrainz.org/ws/2/recording
```

O endpoint não é configurável por resposta externa. Redirects são recusados. A resposta é limitada e normalizada; somente campos necessários permanecem no contrato interno.

Política operacional atual:

- provider version: `ws2-recording-search-v2`;
- User-Agent identificável do Home Music (configurável na composição/teste);
- rate limit compartilhado do gateway: **1 requisição/segundo por padrão**;
- timeout compartilhado: **8 segundos por padrão**;
- cancelamento pelo run via `AbortSignal`;
- cache normalizado: **7 dias** para este analyzer;
- até **5 candidatos** por consulta;
- resposta textual limitada a **1.000.000 caracteres** antes do parse;
- CI/testes usam `fetchImpl` fake; não dependem de internet pública.

A normalização é idempotente: o valor já normalizado armazenado no cache pode passar novamente pelo normalizador sem invalidar a entrada nem gerar uma segunda consulta.

### Dados enviados

A consulta pode usar somente:

- título;
- artista;
- álbum quando confiável;
- valores conservadoramente derivados do filename quando metadata essencial está ausente.

**Nunca é enviado path físico, `folderPath`, `MUSIC_DIR` ou filename bruto.** O bootstrap extrai apenas `basename(filePath)` no backend. O analyzer valida que `fileName`/`folderName` não contêm separadores de caminho e, quando precisa do filename, só aceita a forma conservadora `Artista - Título` (também com travessão). O texto bruto do filename fica apenas como evidência auditável local.

### Busca progressiva

Para metadata confiável, a ordem é:

1. `title + artist + album` quando álbum existe;
2. `title + artist` se a busca restrita não retornar candidatos.

Quando título ou artista estão ausentes/placeholders, o analyzer só consulta se o basename puder fornecer `Artista - Título` sem ambiguidade. Pasta pode apoiar o álbum. Filename sem estrutura clara não dispara consulta externa.

A chave de cache usa a identidade lógica normalizada (`title`, `artist`, `album`), nunca path/filename bruto.

### Matching e score

O matcher conserva pontuação e não executa fuzzy matching agressivo. Acento, caixa e espaços podem ser normalizados; diferença de pontuação continua sendo diferença real.

Pesos da versão atual:

| Sinal | Score |
| --- | ---: |
| título exato | +40 |
| título normalizado | +32 |
| artista exato | +40 |
| artista normalizado | +32 |
| álbum exato | +16 |
| álbum normalizado | +12 |
| álbum conflitante | -8 |
| albumArtist exato/normalizado | +5 / +3 |
| duração até 2 s | +12 |
| duração até 5 s | +7 |
| duração a partir de 12 s | -22 + conflito bloqueante |
| contexto coletivo do mesmo release | +8 |

Conflito de **título**, **artista** ou duração incompatível marca o candidato como bloqueado. Contexto de álbum nunca remove esse bloqueio.

### Confiança e ambiguidade

A banda não é um percentual arbitrário:

- candidato bloqueado ou score abaixo de 55: não gera sugestão;
- `high`: score >= 88 **e** margem para o segundo candidato >= 18;
- `medium`: score >= 68 e margem >= 8;
- demais candidatos elegíveis: `low`;
- margem abaixo de 15 adiciona `ambiguous-candidates`;
- qualquer sugestão que dependa de filename fica limitada a `low`;
- campo com override humano existente fica limitado a `low` e recebe `human-override`.

O run/sugestão também carrega as versões do contrato/algoritmo da fundação, permitindo reproduzir a decisão.

### Contexto coletivo de álbum

Faixas agrupadas pelo mesmo contexto de artista + álbum/pasta podem reforçar um release quando duas ou mais convergem. A evidência `album-context` registra `matchedTracks` e `totalTracks`.

A coerência coletiva é apenas um bônus. Um outlier com conflito forte continua sem sugestão elegível mesmo se o restante do álbum convergir.

### Evidências e IDs externos

Uma sugestão pode carregar:

- `text-match` por campo;
- `duration-delta`;
- `album-context`;
- `file-context` somente com basename/pasta segura;
- `human-override`;
- `external-id` tipado para `recording`, `release`, `release-group` e `artist`.

A proveniência registra `source = musicbrainz`, provider version e recording ID. Payload bruto inteiro não é persistido.

### Decisões humanas

O analyzer recebe a biblioteca **efetiva** e consulta o `TrackMetadataOverrideStore` para saber quais campos têm decisão humana. Ele pode enriquecer outros campos, mas não trata override como “faltante”, não o aplica nem o reverte silenciosamente.

## Falhas e segurança

- 429/503 viram erro recuperável do provider;
- timeout/cancelamento são classificados pelo gateway;
- JSON inválido/resposta incompatível são rejeitados antes de virar candidato;
- resposta vazia produz zero sugestão;
- nenhuma falha do provider altera a biblioteca;
- logs/erros operacionais usam sanitização já existente;
- não são seguidas URLs arbitrárias vindas do payload do MusicBrainz.

## API administrativa

Todas as rotas vivem sob `/api/admin/library-assistant` e usam a política central de admin.

- `POST /api/admin/library-assistant/runs` — inicia análise; exige `X-Home-Music-Request: 1`;
- `GET /api/admin/library-assistant/runs?limit=50` — lista runs;
- `GET /api/admin/library-assistant/runs/:id` — consulta run;
- `GET /api/admin/library-assistant/runs/:id/suggestions?status=review&limit=200` — lista sugestões;
- `POST /api/admin/library-assistant/runs/:id/cancel` — cancela; exige header de mutação.

**Não existe endpoint `apply` nesta entrega.**

## Cobertura de regressão

A fundação continua cobrindo autorização, anti-CSRF, persistência/reopen, stale, cancelamento, concorrência, cache, rate limit, timeout e ausência de mutação.

O analyzer MusicBrainz adiciona fixtures para:

- payload bruto e cache normalizado idempotente;
- acento/caixa/espaços sem apagar pontuação;
- duração próxima e conflitante;
- candidatos ambíguos;
- busca progressiva com e sem álbum;
- contexto coletivo e outlier bloqueado;
- filename útil vs filename enganoso;
- override humano;
- IDs externos tipados;
- resposta vazia, rate limit e JSON inválido;
- endpoint canônico sem envio de path/filename bruto.

## Próximo módulo

A próxima etapa primária é **#313 — revisão e aplicação segura das sugestões de metadata**. Ela deve consumir o contrato estabilizado aqui, sem criar um segundo matcher, lifecycle ou cache concorrente.

O plano amplo permanece em [`library-assistant-plan.md`](library-assistant-plan.md).
