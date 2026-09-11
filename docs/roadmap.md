# Roadmap técnico

Este documento descreve **o estado técnico corrente e o próximo trabalho relevante** do Home Music.

O histórico detalhado acumulado até a fase 14 foi preservado em [`history/roadmap-through-phase-14.md`](history/roadmap-through-phase-14.md). Documentos de implementação da antiga fase 7.5 ficam em [`history/phase-7.5/`](history/phase-7.5/).

## Estado em 2026-09-11

- **Fase 7.5 — multiusuário/autenticação:** concluída e incorporada à arquitetura atual. Fonte canônica: [`multi-user-auth.md`](multi-user-auth.md).
- **Fase 14 — portabilidade de dados pessoais:** implementação concluída na `main` com o PR #324. Contrato atual: [`personal-data-portability.md`](personal-data-portability.md).
- **Fase 15 — Library Assistant:** fase ativa, coordenada pela issue #310. A fundação #311, identificação de metadata #312, revisão/aplicação #313, artwork externo #314, lyrics via LRCLIB #315, resolução unificada de lyrics #316, autonomia progressiva #318, normalização #319, fingerprint opcional #320, fallback canônico de artwork #321 e operação em volume #356 já foram implementadas.
- **#322 — Whisper local para lyrics:** implementação em revisão na PR #375. O fallback é opcional, local, sempre sujeito a revisão humana e reutiliza a cadeia canônica de lyrics/rollback.
- A publicação de artwork canônica no Media Session (#325), vinil animado (#326), continuidade iOS (#327) e cold start offline (#328) já foram incorporadas; validações físicas específicas continuam registradas nas issues correspondentes como QA pós-merge quando aplicável.

A `main` atual já contém exportação/importação de dados pessoais, o Assistente operacional, automação opt-in, cadeia de lyrics unificada, fallback de artwork e os gates E2E/segurança correspondentes. A PR #375 adiciona a capacidade local de transcrição/alinhamento sem transformar Whisper em dependência obrigatória do produto.

## Fase 15 — Library Assistant

Objetivo: evoluir a organização e correção da biblioteca para um fluxo assistido, seguro e reversível, sem transformar sugestões em mutações implícitas.

Princípios:

- `LibraryAssistantService` coordena análise/sugestões sem virar autoridade de biblioteca;
- separar descoberta/análise de aplicação;
- evidências e proveniência devem ser estruturadas, versionadas e explicáveis;
- stale protection deve revalidar a premissa antes de qualquer aplicação;
- preview/revisão antes de mutação;
- operações em lote precisam de resultado rastreável e sucesso parcial explícito;
- backend continua sendo a fronteira de segurança e filesystem confinement;
- nenhuma sugestão deve inventar metadata como fato confirmado;
- o usuário mantém controle explícito sobre alterações físicas e metadata persistida.

### Tracking

Umbrella: **#310 — Library Assistant**.

| Issue | Entrega | Estado técnico |
| --- | --- | --- |
| #311 | fundação de runs/sugestões, evidências, proveniência, stale, cache/provider e lifecycle admin | implementada |
| #312 | identificação de metadata com MusicBrainz e matching explicável | implementada |
| #313 | revisão e aplicação segura de sugestões de metadata | implementada |
| #356 | lote de revisão confirmado, reset operacional e abas Fila/Estatísticas/Configurações | implementada |
| #314 | artwork via Cover Art Archive usando cover override canônico | implementada |
| #315 | enriquecimento de lyrics reutilizando o domínio atual, com LRCLIB, override gerenciado e run operacional independente | implementada |
| #316 | resolução de lyrics consistente entre player/offline/OpenSubsonic | implementada |
| #318 | autonomia progressiva após scan/importação | implementada; opt-in e conservadora |
| #319 | assistência de normalização artista/álbum com evidência MusicBrainz reutilizada | implementada |
| #320 | casos difíceis via Chromaprint/AcoustID opcional | implementada; fallback manual e opt-in |
| #321 | fallback canônico de artwork e representação estática derivada | implementada; materialização persistente continua opcional conforme evolução do domínio |
| #322 | transcrição/alinhamento local opcional com Whisper | em revisão na PR #375 |
| #325 | artwork canônica no Media Session | implementada; QA físico rastreado |
| #326 | vinil animado no player Agora usando a mesma identidade | implementada; QA físico de fluidez/bateria continua manual |
| #327 | continuidade de playback iOS | implementada; validação física adicional rastreada |
| #328 | cold start offline | implementada; validação física adicional rastreada |

O detalhamento de arquitetura, riscos, etapas e critérios está em [`library-assistant-plan.md`](library-assistant-plan.md). O comportamento implementado está em [`library-assistant.md`](library-assistant.md), a normalização assistida em [`library-metadata-normalization.md`](library-metadata-normalization.md), o fallback acústico em [`library-assistant-audio-fingerprint.md`](library-assistant-audio-fingerprint.md) e, para a cadeia efetiva de letras, em [`lyrics.md`](lyrics.md). Se plano e implementação divergirem, código/testes e a issue executada têm precedência.

### Base estabilizada da Fase 15

A Fase 15 agora possui:

- contratos compartilhados/versionados para runs, sugestões, evidências, confiança, proveniência e decisões;
- persistência mínima no mesmo SQLite, sem cópia canônica de `tracks`;
- snapshot/revision da biblioteca efetiva, incluindo projeção administrativa existente;
- assinatura de premissa e stale protection;
- lifecycle de start/list/get/cancel;
- cache derivado de provider com TTL/versionamento, rate limit, timeout, cancelamento e User-Agent;
- regressões de autorização/anti-CSRF, reopen, cancelamento, concorrência e ausência de mutação das autoridades efetivas;
- analyzer real de metadata via MusicBrainz com busca progressiva e endpoint fixo;
- matching conservador e explicável por título, artista, álbum, `albumArtist`, duração e contexto coletivo;
- fallback por basename somente quando metadata essencial está ausente, sem envio de path/filename bruto e sempre limitado a baixa confiança;
- triagem local que limita a fila de metadata/artwork a faixas sem capa efetiva ou com campos ausentes/placeholders, mantendo o total de progresso aderente ao trabalho útil;
- IDs externos tipados de recording/release/release-group/artist;
- proteção explícita de override humano e bloqueio de high confidence em conflito/ambiguidade;
- sugestão de artwork via Cover Art Archive a partir de release confiável, sem download durante a análise;
- aplicação de capa somente por decisão individual e `TrackCoverOverrideStore`, preservando confirmação de substituição de override existente;
- enriquecimento de lyrics via LRCLIB server-side, com matching por identidade/duração, preview curto e conteúdo completo obtido somente no apply;
- execução de `metadata` e `lyrics` em runs independentes iniciados em paralelo pela Administração, com cancelamento conjunto dos runs ativos;
- persistência de letra aprovada em `track_lyrics_overrides`, fora de `MUSIC_DIR`, com provenance, limite defensivo, cascade e rollback para sidecar;
- resolução efetiva de lyrics `override gerenciado → sidecar .lrc/.txt → nenhuma letra`, reutilizada por player, offline e OpenSubsonic sem dependência de rede no playback;
- fallback local opcional de transcrição/alinhamento via Whisper/whisper.cpp, com FFmpeg para PCM, scratch fora de `MUSIC_DIR`, execução sem shell, timeout/output cap/cancelamento e backpressure pela fila pesada compartilhada;
- candidatos Whisper sempre em revisão humana, com proveniência `local-transcription`/`local-alignment`, indicadores de qualidade e fingerprint da letra efetiva para stale protection;
- rollback de letra gerada localmente preservando uma versão gerenciada anterior quando existente, sem criação automática de `.lrc` físico;
- normalização de artista/álbum preservando a heurística e store existentes, enriquecida por evidências MusicBrainz já persistidas pelo Assistente, com conflitos de IDs bloqueando sugestão canônica segura;
- fallback manual de identificação por áudio somente para metadata ainda difícil, usando Chromaprint/`fpcalc` local e AcoustID opcional;
- resolução física de fingerprint por `trackId` server-side, com `realpath`, confinement, arquivo regular e revalidação depois do trabalho pesado;
- cache de fingerprint associado a assinatura física do arquivo, com invalidação quando conteúdo/identidade física muda e cascade quando a faixa some;
- AcoustID com opt-in explícito, segredo somente no servidor e gateway compartilhado para rate limit/cache/timeout/cancelamento;
- retorno dos candidatos acústicos ao `rankMusicBrainzCandidate` existente, sem criar segundo matcher, com reason codes próprios para match forte, múltiplas gravações, duração conflitante e conflito externo;
- workspace **Administração → Assistente da Biblioteca** com Sugestões, Fila, Estatísticas e Configurações;
- apply/reject por campo e seleção em lote de metadata/letras também para itens de revisão quando há confirmação explícita;
- artwork permanece fora do lote mesmo com confirmação de revisão;
- requests de lote limitados a 100 decisões, com chunking na Web, sucesso parcial e diagnóstico por outcome/mensagem;
- aplicação de metadata exclusivamente via `TrackMetadataOverrideStore`, sem `UPDATE tracks`, sem escrita de tags e com remoção canônica de override redundante;
- revalidação antes da decisão e stale quando a premissa efetiva/humana mudou, inclusive em lote confirmado;
- reset operacional que invalida somente `pending/review` revisável, preserva `applied/rejected` e histórico, e inicia reanálise completa;
- autonomia progressiva opt-in sobre eventos consistentes da biblioteca, mantendo o fluxo manual como fallback e evitando auto-apply fora da política segura;
- atualização do snapshot efetivo/ETag após apply sem exigir rescan;
- visualização de fila e métricas existentes sem criar uma segunda fonte de observabilidade;
- preferências de campos de metadata exibidos mantidas como configuração local de apresentação, sem mudar o analyzer ou enfraquecer segurança.

O fluxo vertical é: **analisar mudanças → revisar/selecionar metadata e letras → usar evidência externa na normalização → usar fingerprint quando um caso difícil precisar de evidência adicional → opcionalmente produzir candidato local de lyrics com Whisper → confirmar quando necessário → aplicar em lote → revisar capas individualmente → acompanhar fila/estatísticas**. Novas capacidades devem reutilizar esse contrato de revisão em vez de criar lifecycle paralelo.

## Portabilidade pessoal — estado consolidado

O ciclo da fase 14 deixou como contrato atual:

- exportação versionada dos dados pertencentes ao usuário autenticado;
- importação com validação e dry-run antes da aplicação;
- merge explícito sem permitir cross-user ownership;
- superfície de Minha conta para importar/exportar;
- regressões de segurança e smoke de backup/restore promovidos ao CI;
- E2E focado de `personal-data-import` promovido ao CI.

Detalhes de produto/API: [`personal-data-portability.md`](personal-data-portability.md).

Detalhes de identidade/ownership: [`multi-user-auth.md`](multi-user-auth.md).

## Trabalho paralelo fora da fase 15

Bugs e melhorias podem permanecer fora da fase quando corrigem comportamento existente sem mudar o escopo do Library Assistant. As correções de PWA #327/#328 já foram incorporadas; validação física adicional permanece como QA rastreado nas próprias issues e não redefine a arquitetura da Fase 15.

O roadmap não replica todos os bugs abertos. Para estado operacional de issues, o GitHub é a fonte de verdade.

## Critério para adicionar uma nova fase

Uma nova fase deve entrar aqui quando houver:

1. objetivo de produto/arquitetura claro;
2. issue umbrella ou decisão equivalente;
3. fronteiras explícitas de escopo;
4. riscos e critérios de aceitação identificados;
5. relação com documentação canônica definida.

Planos exploratórios devem usar nome explícito (`*-plan.md`, ADR ou issue) e não ser apresentados como comportamento já entregue.

## Fontes de verdade

Ordem prática para resolver divergências:

1. código, testes, `package.json`, workflows e contratos executáveis;
2. documentação canônica atual (`README.md`, `DEVELOPMENT.md`, `PRODUCTION.md`, `architecture.md` e docs de domínio);
3. este roadmap e issues abertas;
4. documentos em `docs/history/` como contexto histórico.

Não use documentos `phase-*` arquivados como especificação operacional atual.
