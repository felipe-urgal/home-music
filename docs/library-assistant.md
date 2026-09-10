# Assistente da Biblioteca

## Estado

A base operacional da Fase 15 possui oito entregas implementadas no fluxo assistido:

- **#311 — fundação:** contratos, runs, sugestões, persistência auditável, stale protection, lifecycle administrativo, fila/observabilidade e gateway seguro de providers;
- **#312 — identificação de metadata:** analyzer real usando contexto local + MusicBrainz para produzir sugestões explicáveis de `title`, `artist`, `album` e `albumArtist`;
- **#313 — revisão/aplicação segura:** workspace administrativo para revisar, rejeitar e aplicar sugestões de metadata por campo, sempre pela autoridade canônica de overrides;
- **#314 — artwork via Cover Art Archive:** sugestões de capa derivadas de identificação confiável do MusicBrainz, com download somente após apply individual explícito;
- **#315 — lyrics externas:** LRCLIB opera em run `lyrics` independente, iniciado em paralelo ao run de metadata, mantendo a revisão unificada e a resolução canônica de letras;
- **#319 — normalização assistida:** a revisão existente de artistas/álbuns reutiliza evidências MusicBrainz persistidas pelo Assistente, sem segundo motor/store de aliases;
- **#320 — fingerprint acústico:** casos difíceis podem usar Chromaprint/`fpcalc` local e AcoustID opcional como evidência adicional do matcher existente;
- **#356 — operação em volume:** lote real de metadata com confirmação de revisão, reset seguro de sugestões abertas e superfícies de Fila, Estatísticas e Configurações.

A operação também possui uma **política de revisão persistida no servidor**. Para título, artista, álbum, artista do álbum e letras, o administrador escolhe `Ignorar`, `Revisar` ou `Lote`; capa aceita apenas `Ignorar` ou `Revisar` e continua sempre individual. A política não reduz o escopo do analyzer e não aplica nada em segundo plano: `Lote` apenas reúne sugestões seguras para uma confirmação conjunta explícita.

`metadata` e `lyrics` são capabilities independentes. A Administração dispara os dois runs em paralelo no fluxo normal e cancela os runs ativos em conjunto, preservando métricas, cache, retries e incrementalidade por capability sem criar uma segunda experiência de revisão.

A análise continua separada da mutação. Nenhuma sugestão é aplicada automaticamente após scan/importação ou apenas por possuir alta confiança. Aplicar depende de uma decisão administrativa explícita e de nova validação no backend.

## Autoridades preservadas

O Assistente é um orquestrador, não um segundo catálogo. As fontes de verdade continuam sendo:

- `MUSIC_DIR` + scanner para estado físico;
- `LibraryService` para snapshot base e revision;
- projeção administrativa para metadata/aliases/cover override;
- `TrackMetadataOverrideStore` para decisões humanas de metadata;
- `TrackCoverOverrideStore` para capa efetiva;
- domínio canônico de lyrics para letra publicada.

As tabelas `library_assistant_*` guardam somente estado derivado/auditável e preferências operacionais do Assistente; nunca substituem `tracks`.

Aplicar metadata usa exclusivamente `TrackMetadataOverrideStore.patch()`. Não existe `UPDATE tracks` direto, escrita de tags ou alteração do arquivo físico. Quando o valor sugerido converge para o valor físico, a semântica canônica do store evita override redundante.

Aplicar artwork usa o `TrackCoverOverrideStore` existente. A imagem externa só é baixada depois da decisão individual; o Assistente não escreve capa diretamente no arquivo de áudio nem cria uma segunda persistência canônica.

## Contratos compartilhados

Os contratos que cruzam web/server vivem em `@home-music/shared/library-assistant` e possuem versão explícita. Eles definem:

- capabilities `metadata`, `artwork` e `lyrics`;
- lifecycle de run (`queued`, `running`, `completed`, `failed`, `cancelled`, `stale`);
- sugestões e status;
- confidence bands `low`, `medium`, `high`;
- reason codes estáveis;
- evidências tipadas/versionadas;
- proveniência e IDs externos tipados;
- targets por capability, incluindo identificação/URLs controladas de artwork;
- política de revisão tipada (`ignore`, `review`, `bulk`), com artwork sem `bulk`, e contratos administrativos de leitura/escrita;
- decisões `apply`/`reject`, resultado individual e resumo de lote;
- confirmação explícita de lote que contém sugestões de revisão de metadata;
- confirmação opcional para substituir override de capa existente na decisão individual;
- resposta tipada do reset de sugestões abertas.

Cada sugestão textual representa **um campo** de metadata. Por isso, “aplicar parte” de uma identificação significa aceitar somente as sugestões/campos desejados; não existe um payload paralelo de `fields[]` que duplique essa autoridade.

Payload externo arbitrário nunca vira regra de domínio. MusicBrainz e Cover Art Archive são normalizados/validados antes de entrar no lifecycle de revisão.

## Persistência, snapshot e stale protection

`LibraryAssistantStore` usa o mesmo SQLite da aplicação e mantém:

- `library_assistant_runs`;
- `library_assistant_suggestions`;
- `library_assistant_provider_cache`.

A preferência operacional usa o mesmo SQLite por meio de `LibraryAssistantReviewPolicyStore`, em uma linha única de `library_assistant_review_policy`. Ausência ou payload persistido inválido volta para a política segura padrão (`review` em todos os tipos), sem alterar o catálogo nem bloquear a abertura do Assistente.

Limites atuais:

- até 200 runs terminais retidos por padrão;
- até 500 sugestões por run;
- até 32 evidências por sugestão;
- até 64 KiB de payload persistido por sugestão/cache;
- até 500 entradas de cache de provider;
- TTL máximo global do gateway: 30 dias.

Ao iniciar um run, `LibraryAssistantService` captura a biblioteca efetiva projetada e sua revision. Cada sugestão recebe assinatura SHA-256 da premissa relevante. Mudança de revision/premissa torna o run ou a sugestão `stale` no lifecycle de análise.

Na revisão de metadata, o backend revalida novamente a existência da faixa, o status da sugestão, o valor atual esperado e a decisão humana **do mesmo campo** antes de aplicar. `TrackMetadataOverrideStore` mantém uma revisão auxiliar por campo: uma edição de `artist` não invalida uma sugestão ainda válida de `title`, enquanto uma decisão explícita posterior sobre `title` — inclusive reafirmando o mesmo valor efetivo — torna a sugestão antiga de `title` stale. Assim, nenhuma edição humana é sobrescrita silenciosamente e campos irmãos continuam revisáveis de forma independente.

Na revisão de artwork, o backend revalida a capa efetiva/versão esperada antes de baixar e persistir a imagem. Se a capa mudou desde a análise, a sugestão fica stale; um override manual existente exige confirmação explícita de substituição.

Runs encontrados em `queued/running` após restart viram `failed/interrupted`; cancelamento, falha e shutdown invalidam sugestões parciais ainda abertas.

O reset operacional da #356 também usa `stale` em vez de apagar histórico: sugestões ainda `pending/review` dos runs revisáveis de metadata/artwork são invalidadas, inclusive artwork produzido dentro de um run de metadata. Sugestões `applied` e `rejected` permanecem auditáveis, assim como os runs anteriores. O reset é recusado enquanto existe uma análise revisável ativa.

## Execução e backpressure

O Assistente reutiliza `HeavyWorkQueue` e `LongJobObservability`; não cria uma segunda fila. O shutdown aborta controllers ativos, aguarda o trabalho agendado e somente depois fecha o store.

A execução incremental é o caminho normal. Antes de consultar providers externos, a análise de metadata/artwork faz uma triagem local e inclui somente faixas sem capa efetiva ou com título, artista, álbum ou artista do álbum ausente/reconhecido como placeholder (por exemplo, `Artista desconhecido`). **Analisar mudanças** planeja novamente, dentro desse conjunto, faixas novas, alteradas e trabalho que não terminou com estado reutilizável. **Limpar e reanalisar tudo** é a ação excepcional: invalida sugestões abertas e refaz todas as faixas que continuam elegíveis (`full: true`), sem consultar novamente faixas que já têm capa e metadados locais completos.

A política de revisão é aplicada **depois** da análise. Trocar um tipo entre `Ignorar`, `Revisar` e `Lote` não dispara nova consulta externa e não invalida o run: sugestões já calculadas podem voltar a aparecer imediatamente quando a política deixa de ignorá-las.

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

## Artwork / Cover Art Archive (#314)

Quando a identificação do MusicBrainz fornece release/release-group confiável e a faixa não possui capa adequada, o Assistente pode produzir uma sugestão `artwork` apontando para o Cover Art Archive. A análise persiste apenas a referência/URL controlada; **não baixa a imagem durante a análise**.

A aplicação de artwork é sempre individual. Mesmo que a sugestão tenha alta confiança e mesmo que um request de lote use `confirmReview=true`, o backend rejeita artwork no endpoint de lote. Isso preserva a confirmação explícita antes de download/persistência externa e evita transformar confirmação de metadata em autorização implícita de capa.

O downloader aceita somente hosts/redirects permitidos, limita redirects/tamanho e entrega os bytes ao `TrackCoverOverrideStore.save()`. Se já existir override manual de capa, a decisão precisa sinalizar explicitamente `replaceExistingArtworkOverride=true` antes da substituição.

Detalhes de persistência e política de capa: [`admin-cover-overrides.md`](admin-cover-overrides.md).

## Revisão e aplicação administrativa (#313 + #314 + #315 + #356)

A superfície **Administração → Assistente da Biblioteca** organiza o fluxo em quatro seções funcionais:

### Sugestões

- **Analisar biblioteca/Analisar mudanças** inicia runs de `metadata` e `lyrics` sem aplicar resultados automaticamente;
- metadata, artwork e lyrics revisáveis podem ser aplicados/rejeitados individualmente pelas capacidades já suportadas;
- a política `Ignorar` remove somente sugestões abertas daquele tipo da listagem; histórico resolvido continua consultável e o analyzer continua verificando o tipo;
- a política `Revisar` mantém o item no fluxo manual normal;
- a política `Lote` faz a Web reunir automaticamente apenas sugestões abertas que também passam por `isLibraryAssistantAutoApplicable`; o administrador ainda precisa acionar **Aplicar lote**;
- sugestões que exigem revisão continuam fora do lote da política, mesmo quando o tipo está configurado como `Lote`;
- artwork não possui modo `Lote` no contrato nem na UI e continua fora de qualquer lote;
- **Selecionar seguras** permanece disponível para seleção manual de sugestões visíveis e elegíveis ao lote seguro;
- **Selecionar visíveis** permite seleção manual das sugestões abertas elegíveis exibidas, inclusive itens de `Revisão`;
- se uma seleção manual contém `Revisão`, a Web exige confirmação explícita antes de enviar o lote;
- o backend recebe `confirmReview=true` somente nesse fluxo manual confirmado e continua revalidando cada item;
- cada request contém no máximo 100 decisões; seleções maiores são particionadas pela Web em blocos de até 100;
- sucesso parcial é preservado e o resumo distingue aplicadas, já resolvidas, stale, não encontradas, não suportadas e falhas;
- mensagens específicas devolvidas pelo servidor ficam disponíveis em **Ver detalhes**;
- artwork exige decisão individual, valida a capa atual e só então baixa/persiste a imagem.

A confirmação de revisão **não** torna a sugestão auto-aplicável e não desliga stale protection. Mesmo com `confirmReview=true`, cada decisão de metadata passa pela mesma validação de run, status, valor esperado, metadata efetiva e revisão humana do campo. Um cliente que omite a confirmação continua impedido pelo backend de aplicar em lote uma sugestão de metadata não elegível ao lote seguro. Artwork continua bloqueado no lote em qualquer modo.

### Fila

A aba **Fila** expõe o estado operacional da análise mais recente: processando, pendentes, retry, encontradas, sem resultado e falhas. Enquanto um run está ativo é possível cancelá-lo. Após um run terminal, **Analisar mudanças** é o mecanismo de retry; trabalho anterior que terminou em falha não é tratado como resultado incremental reutilizável.

### Estatísticas

A aba **Estatísticas** reaproveita métricas já observadas pelo backend: tempo decorrido, throughput, consultas externas, cache hit rate, retries e espera por rate limit. Ela também mostra um histórico compacto dos últimos runs de metadata, sem criar uma segunda fonte de telemetria.

### Configurações

A aba **Configurações** persiste uma única política administrativa no servidor, em vez de usar `localStorage` do navegador. Os tipos `Título`, `Artista`, `Álbum`, `Artista do álbum` e `Letras` aceitam:

- **Ignorar** — oculta sugestões ainda abertas daquele tipo, sem apagar histórico e sem impedir análise;
- **Revisar** — mantém aplicação/rejeição individual;
- **Lote** — inclui automaticamente somente sugestões seguras daquele tipo na caixa **Prontas para aplicar em lote**; nada é aplicado até o clique explícito.

`Capa` aceita somente **Ignorar** e **Revisar**. O backend valida a política completa e rejeita `bulk` para artwork mesmo que um cliente tente enviar esse valor manualmente. Segurança, stale protection, confirmação de revisão e a aplicação individual de capa não podem ser desativadas pela política.

### Reset operacional

**Limpar e reanalisar tudo** possui confirmação própria. O servidor invalida somente sugestões abertas (`pending/review`) dos runs revisáveis de metadata/artwork, marcando-as `stale`; isso inclui sugestões `artwork` produzidas em um run de metadata. `applied`, `rejected` e o histórico de runs são preservados. A operação é recusada se existir run revisável ativo. Depois de um reset bem-sucedido, a Web solicita uma nova análise completa.

Após apply confirmado, a UI publica `home-music:library-changed` e o snapshot efetivo é atualizado sem exigir rescan.

Ao reabrir/atualizar o workspace, estados terminais permanecem explícitos: falha do run mostra a mensagem/ação sanitizada, cancelamento continua identificado e um run concluído com zero candidatos informa que nenhuma alteração foi aplicada.

## API administrativa

Todas as rotas vivem sob `/api/admin/library-assistant` e usam a política central de admin. Leituras retornam `Cache-Control: private, no-store`. Mutações exigem `X-Home-Music-Request: 1`.

Lifecycle/análise:

- `POST /api/admin/library-assistant/runs` — inicia análise incremental ou completa com `full=true`;
- `GET /api/admin/library-assistant/runs?limit=50` — lista runs;
- `GET /api/admin/library-assistant/runs/:id` — consulta run;
- `GET /api/admin/library-assistant/runs/:id/progress` — progresso e métricas observadas;
- `GET /api/admin/library-assistant/runs/:id/suggestions?status=review&limit=200` — lista sugestões;
- `POST /api/admin/library-assistant/runs/:id/cancel` — cancela análise.

Revisão/aplicação:

- `GET /api/admin/library-assistant/review?limit=200` — fila revisável de metadata/artwork/lyrics com snapshot efetivo/físico necessário à decisão;
- `GET /api/admin/library-assistant/policy` — lê a política administrativa persistida;
- `PUT /api/admin/library-assistant/policy` — substitui a política completa após validação server-side;
- `POST /api/admin/library-assistant/review/reset` — invalida sugestões abertas dos runs revisáveis, preservando decisões resolvidas/histórico;
- `POST /api/admin/library-assistant/suggestions/:id/decision` — aplica ou rejeita individualmente metadata/artwork/lyrics suportados;
- `POST /api/admin/library-assistant/decisions` — executa até 100 decisões; `confirmReview` libera somente sugestões revisadas suportadas e artwork continua individual; retorna resultado por item + resumo de sucesso parcial.

## Falhas e segurança

- 429/503 viram erro recuperável do provider;
- timeout/cancelamento são classificados pelo gateway;
- JSON inválido/resposta incompatível são rejeitados antes de virar candidato;
- resposta vazia produz zero sugestão;
- nenhuma falha do provider altera a biblioteca;
- logs/erros operacionais usam sanitização já existente;
- não são seguidas URLs arbitrárias vindas do payload do MusicBrainz;
- downloads de artwork obedecem allowlist/limites do Cover Art Archive;
- `user` não pode acessar revisão/aplicação/configuração administrativa;
- mutações sem o header anti-CSRF são rejeitadas;
- política com campos desconhecidos, modos inválidos ou `bulk` para artwork é rejeitada pelo backend;
- sugestão stale não sobrescreve metadata/capa humana;
- lote de revisão de metadata sem confirmação explícita é rejeitado por item no backend;
- artwork é rejeitado no endpoint de lote mesmo com confirmação de revisão;
- reset não apaga decisões `applied/rejected`;
- aplicar/rejeitar novamente é idempotente no lifecycle do Assistente.

## Cobertura de regressão

A fundação continua cobrindo autorização, anti-CSRF, persistência/reopen, stale, cancelamento, concorrência, cache, rate limit, timeout e ausência de mutação.

O analyzer MusicBrainz cobre payload/cache normalizado, matching, duração, ambiguidade, contexto coletivo, filename seguro, override humano, IDs externos, consulta única por identidade e falhas do provider. O fluxo de artwork possui regressões próprias para resolução/URL/redirect do Cover Art Archive e aplicação via override canônico.

A revisão/aplicação cobre:

- aplicação de um campo via override canônico;
- rejeição sem alterar metadata efetiva;
- idempotência de apply/reject;
- stale quando o mesmo campo efetivo muda após análise;
- stale quando existe nova decisão explícita no mesmo campo mesmo sem mudança efetiva;
- preservação de sugestões de campos irmãos quando somente outro campo foi editado/aplicado;
- exposição do valor físico na fila quando difere do efetivo;
- convergência ao físico sem override redundante;
- lote com sucesso parcial;
- bloqueio de revisão de metadata em lote sem confirmação e aplicação após confirmação;
- stale protection preservada em lote confirmado;
- artwork permanecendo individual mesmo com lote confirmado;
- limite server-side de 100 decisões por request e chunking da Web para seleções maiores;
- política de revisão com default seguro, persistência/reopen, rejeição de `bulk` para artwork, admin-only e anti-CSRF;
- reset preservando decisões resolvidas e invalidando metadata/artwork ainda abertos;
- reset bloqueado durante análise revisável ativa;
- autorização e anti-CSRF das rotas de revisão/reset;
- cliente Web mantendo payload explícito e header de mutação.

As entregas #315, #319 e #320 acrescentam regressões determinísticas próprias para execução independente de lyrics, evidência externa na normalização e subprocesso/filesystem/AcoustID, respectivamente. Nenhum desses testes depende de internet pública.

## Próximos módulos

O fluxo completo **analisar → revisar → aplicar** permanece a base das próximas capacidades. A experiência coerente entre superfícies (#316), transcrição/alinhamento local opcional (#322) e autonomia progressiva (#318) devem reutilizar as mesmas autoridades, stale protection e confirmação explícita em vez de criar lifecycles paralelos. O planejamento está em [`library-assistant-plan.md`](library-assistant-plan.md).