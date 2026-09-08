# Assistente da Biblioteca

## Estado

A Fase 15 possui três camadas implementadas:

- **#311 — fundação:** contratos, runs, sugestões, persistência auditável, stale protection, lifecycle administrativo, fila/observabilidade e gateway seguro de providers;
- **#312 — identificação de metadata:** analyzer real usando contexto local + MusicBrainz para produzir sugestões explicáveis de `title`, `artist`, `album` e `albumArtist`;
- **#313 — revisão/aplicação segura:** workspace administrativo para revisar, rejeitar e aplicar sugestões de metadata por campo, individualmente ou em lote explícito, sempre pela autoridade canônica de overrides.

A análise continua separada da mutação. Nenhuma sugestão é aplicada automaticamente após scan/importação ou apenas por possuir alta confiança. Aplicar depende de uma decisão administrativa explícita e de nova validação no backend.

## Autoridades preservadas

O Assistente é um orquestrador, não um segundo catálogo. As fontes de verdade continuam sendo:

- `MUSIC_DIR` + scanner para estado físico;
- `LibraryService` para snapshot base e revision;
- projeção administrativa para metadata/aliases/cover override;
- `TrackMetadataOverrideStore` para decisões humanas de metadata;
- `TrackCoverOverrideStore` para capa efetiva;
- domínio canônico de lyrics para letra publicada.

As tabelas `library_assistant_*` guardam somente estado derivado/auditável e nunca substituem `tracks`.

Na #313, aplicar metadata usa exclusivamente `TrackMetadataOverrideStore.patch()`. Não existe `UPDATE tracks` direto, escrita de tags ou alteração do arquivo físico. Quando o valor sugerido converge para o valor físico, a semântica canônica do store evita override redundante.

## Contratos compartilhados

Os contratos que cruzam web/server vivem em `@home-music/shared/library-assistant` e possuem versão explícita. Eles definem:

- capabilities `metadata`, `artwork` e `lyrics`;
- lifecycle de run (`queued`, `running`, `completed`, `failed`, `cancelled`, `stale`);
- sugestões e status;
- confidence bands `low`, `medium`, `high`;
- reason codes estáveis;
- evidências tipadas/versionadas;
- proveniência e IDs externos tipados;
- targets por capability;
- decisões `apply`/`reject`, resultado individual e resumo de lote;
- regra compartilhada de elegibilidade do lote seguro.

Cada sugestão textual representa **um campo** de metadata. Por isso, “aplicar parte” de uma identificação significa aceitar somente as sugestões/campos desejados; não existe um payload paralelo de `fields[]` que duplique essa autoridade.

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

Ao iniciar um run, `LibraryAssistantService` captura a biblioteca efetiva projetada e sua revision. Cada sugestão recebe assinatura SHA-256 da premissa relevante. Mudança de revision/premissa torna o run ou a sugestão `stale` no lifecycle de análise.

Na revisão da #313, o backend revalida novamente a existência da faixa, o status da sugestão, o valor atual esperado e a decisão humana **do mesmo campo** antes de aplicar. `TrackMetadataOverrideStore` mantém uma revisão auxiliar por campo: uma edição de `artist` não invalida uma sugestão ainda válida de `title`, enquanto uma decisão explícita posterior sobre `title` — inclusive reafirmando o mesmo valor efetivo — torna a sugestão antiga de `title` stale. Assim, nenhuma edição humana é sobrescrita silenciosamente e campos irmãos continuam revisáveis de forma independente.

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

A consulta ao MusicBrainz usa somente:

- título;
- artista;
- valores conservadoramente derivados do filename quando metadata essencial está ausente.

Álbum e pasta continuam fazendo parte do contexto local para ranking, escolha de release e coerência coletiva, mas não aumentam o número de consultas externas.

**Nunca é enviado path físico, `folderPath`, `MUSIC_DIR` ou filename bruto.** O bootstrap extrai apenas `basename(filePath)` no backend. O analyzer valida que `fileName`/`folderName` não contêm separadores de caminho e, quando precisa do filename, só aceita a forma conservadora `Artista - Título` (também com travessão). O texto bruto do filename fica apenas como evidência auditável local.

### Busca simples e ranking local

Cada identidade pesquisável faz no máximo uma consulta lógica por `title + artist`. O álbum não dispara uma segunda busca: ele é aplicado localmente no score e na escolha do melhor release entre os candidatos retornados.

Quando título ou artista estão ausentes/placeholders, o analyzer só consulta se o basename puder fornecer `Artista - Título` sem ambiguidade. Pasta pode apoiar o álbum localmente. Filename sem estrutura clara não dispara consulta externa.

A chave de cache usa a mesma identidade lógica da consulta externa (`title`, `artist`), nunca álbum, path ou filename bruto. Assim, consultas equivalentes reaproveitam o mesmo resultado mesmo quando a faixa aparece em álbuns diferentes, e uma resposta vazia não provoca outra chamada idêntica ao MusicBrainz.

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

## Revisão e aplicação administrativa (#313)

A superfície **Administração → Assistente da Biblioteca** organiza o fluxo em:

1. **Analisar biblioteca** — inicia um run de metadata; nenhum resultado é aplicado automaticamente;
2. **Revisar** — mostra campo, valor físico quando diverge, valor efetivo atual, valor sugerido, confiança, provider e motivos/evidências relevantes;
3. **Decidir** — cada campo pode ser aplicado ou rejeitado individualmente;
4. **Lote explícito** — somente sugestões selecionadas e classificadas como seguras entram no lote;
5. **Reconciliar** — após sucesso, a UI publica `home-music:library-changed` e o snapshot efetivo é atualizado sem exigir rescan.

Filtros atuais cobrem abertas, seguras, revisão necessária, stale, aplicadas, rejeitadas, falhas e todas. Confiança/conflito possuem rótulos textuais e não dependem apenas de cor. Sugestões com `human-override`, ambiguidade ou conflito não entram na seleção segura automática.

A regra de lote seguro é compartilhada entre Web e backend e o servidor é a autoridade final: `apply` em lote exige sugestão aberta, `high` confidence e ausência de `human-override`, `ambiguous-candidates`, `source-conflict` e `metadata-conflict`. Um cliente modificado não consegue transformar uma sugestão de revisão em aplicação de lote apenas alterando o payload.

O backend processa decisões de lote isoladamente: uma falha/stale não apaga os sucessos já confirmados nem mascara os demais resultados. Retry sempre passa novamente pelas validações de existência/estado/premissa.

Cancelamento de **análise** interrompe novos trabalhos do run e não reverte resultados já concluídos; cancelamento não transforma sugestões em aplicação automática. **Cancelar lote** é observado entre decisões: o item em andamento pode concluir, nenhum novo item é iniciado, sucessos confirmados permanecem e os itens não iniciados continuam selecionados para retry/revisão.

Ao reabrir/atualizar o workspace, estados terminais permanecem explícitos: falha do run mostra a mensagem/ação sanitizada, cancelamento continua identificado e um run concluído com zero candidatos informa que nenhuma alteração foi aplicada.

## API administrativa

Todas as rotas vivem sob `/api/admin/library-assistant` e usam a política central de admin. Leituras retornam `Cache-Control: private, no-store`. Mutações exigem `X-Home-Music-Request: 1`.

Lifecycle/análise:

- `POST /api/admin/library-assistant/runs` — inicia análise;
- `GET /api/admin/library-assistant/runs?limit=50` — lista runs;
- `GET /api/admin/library-assistant/runs/:id` — consulta run;
- `GET /api/admin/library-assistant/runs/:id/suggestions?status=review&limit=200` — lista sugestões;
- `POST /api/admin/library-assistant/runs/:id/cancel` — cancela análise.

Revisão/aplicação:

- `GET /api/admin/library-assistant/review?limit=200` — fila revisável com snapshot efetivo/físico necessário à decisão;
- `POST /api/admin/library-assistant/suggestions/:id/decision` — aplica ou rejeita uma sugestão/campo;
- `POST /api/admin/library-assistant/decisions` — executa até 100 decisões explícitas e retorna resultado por item + resumo de sucesso parcial.

## Falhas e segurança

- 429/503 viram erro recuperável do provider;
- timeout/cancelamento são classificados pelo gateway;
- JSON inválido/resposta incompatível são rejeitados antes de virar candidato;
- resposta vazia produz zero sugestão;
- nenhuma falha do provider altera a biblioteca;
- logs/erros operacionais usam sanitização já existente;
- não são seguidas URLs arbitrárias vindas do payload do MusicBrainz;
- `user` não pode acessar revisão/aplicação administrativa;
- mutações sem o header anti-CSRF são rejeitadas;
- sugestão stale não sobrescreve metadata humana;
- aplicar/rejeitar novamente é idempotente no lifecycle do Assistente.

## Cobertura de regressão

A fundação continua cobrindo autorização, anti-CSRF, persistência/reopen, stale, cancelamento, concorrência, cache, rate limit, timeout e ausência de mutação.

O analyzer MusicBrainz cobre payload/cache normalizado, matching, duração, ambiguidade, contexto coletivo, filename seguro, override humano, IDs externos, consulta única por identidade e falhas do provider.

A revisão/aplicação adiciona regressões para:

- aplicação de um campo via override canônico;
- rejeição sem alterar metadata efetiva;
- idempotência de apply/reject;
- stale quando o mesmo campo efetivo muda após análise;
- stale quando existe nova decisão explícita no mesmo campo mesmo sem mudança efetiva;
- preservação de sugestões de campos irmãos quando somente outro campo foi editado/aplicado;
- exposição do valor físico na fila quando difere do efetivo;
- convergência ao físico sem override redundante;
- lote com sucesso parcial e validação server-side da elegibilidade segura;
- autorização e anti-CSRF das rotas de revisão;
- cliente Web mantendo payload explícito e header de mutação.

## Próximos módulos

A #313 encerra o primeiro fluxo completo **analisar → revisar → aplicar metadata**. As capacidades posteriores continuam no [`library-assistant-plan.md`](library-assistant-plan.md), principalmente artwork (#314), lyrics (#315/#316) e autonomia progressiva somente depois de o fluxo manual estar estabilizado.