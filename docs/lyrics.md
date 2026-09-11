# Lyrics

O Home Music possui uma única cadeia efetiva de letras para o player, API HTTP e OpenSubsonic. O enriquecimento externo do Assistente da Biblioteca e o fallback local opcional com Whisper ampliam essa cadeia sem criar um segundo endpoint, parser ou catálogo público de letras.

## Resolução canônica

A ordem de resolução é:

1. letra gerenciada e aprovada em `track_lyrics_overrides`;
2. sidecar físico local `.lrc` ou `.txt` ao lado do áudio;
3. nenhuma letra.

O parser existente de `apps/server/src/lyrics.ts` continua sendo a fonte de verdade para conteúdo plain e LRC sincronizado, incluindo timestamps e `offset`. A rota `/api/tracks/:id/lyrics`, o player e `getLyricsBySongId` do OpenSubsonic chegam à mesma resolução por `TrackMediaInfrastructure.lyrics()`.

A reprodução nunca consulta um provider externo nem executa Whisper. Depois da aprovação, o conteúdo necessário para playback está no SQLite local; se provider, FFmpeg ou Whisper estiverem offline/indisponíveis, a reprodução e a leitura de letras já aprovadas continuam funcionando normalmente.

## Persistência gerenciada

Letras aprovadas pelo Assistente ficam na tabela SQLite `track_lyrics_overrides`, fora do arquivo de áudio e fora de `MUSIC_DIR`.

Cada registro contém:

- `track_id` com `ON DELETE CASCADE`;
- modo `plain` ou `synced`;
- conteúdo normalizado, limitado a 48 KiB em UTF-8;
- origem `external`, `manual` ou `generated`;
- provider e identificador externo quando existirem;
- idioma quando conhecido;
- `updated_at`.

Como o override faz parte do banco principal, ele segue a estratégia normal de backup/restore da aplicação. Remover a letra gerenciada não altera o áudio nem o sidecar.

Quando uma letra gerada localmente substitui outro override gerenciado, o store preserva uma única versão anterior em `track_lyrics_override_history`. A ação de rollback restaura essa fonte anterior; se não existia override anterior, a resolução volta automaticamente ao `.lrc`/`.txt` físico quando ele existir.

## LRCLIB

A fonte externa inicial é o LRCLIB. A integração ocorre somente no servidor e passa pelo `LibraryAssistantProviderGateway`, reutilizando timeout, rate limit, cache, deduplicação de chamadas e cancelamento da infraestrutura do Assistente.

A análise usa título, artista e álbum, além de duração como evidência de matching quando disponível. Título e artista incompatíveis bloqueiam o vínculo; duração muito divergente também bloqueia. Uma sugestão só é classificada como alta confiança quando a identidade é forte, a duração está próxima e não há candidato concorrente equivalente. Resultados ambíguos permanecem em revisão.

A sugestão persistida não contém a letra completa. Ela guarda o identificador do candidato, sincronização, proveniência e um preview curto. O conteúdo completo é buscado novamente por ID no momento do `apply`, validado e limitado antes de ser salvo. Se um sidecar local surgir entre análise e aplicação, a sugestão fica stale e não substitui o arquivo local.

O Home Music identifica suas requisições com `User-Agent` próprio, trata `404` como ausência normal e respeita respostas de limitação/indisponibilidade pelo gateway. A política e disponibilidade do LRCLIB podem mudar; a integração deve degradar com segurança em vez de assumir disponibilidade eterna.

Referência vigente do provider: <https://lrclib.net/docs>.

## Fallback local opcional com Whisper

O fallback local da #322 é uma capacidade administrativa opcional. Ele não baixa modelos automaticamente, não envia áudio para terceiros e não participa do playback. O operador instala o executável/modelo localmente e habilita a capacidade por configuração do servidor.

Configuração:

- `HOME_MUSIC_WHISPER_PATH`: caminho **absoluto** para o executável local compatível com `whisper.cpp`;
- `HOME_MUSIC_WHISPER_MODEL`: caminho para um modelo já instalado pelo operador;
- `HOME_MUSIC_FFMPEG_PATH`: comando/caminho do FFmpeg usado para preparar PCM mono 16 kHz; quando ausente, usa `ffmpeg`.

Sem `HOME_MUSIC_WHISPER_PATH` ou modelo válido, a capability aparece como indisponível e o restante do Home Music continua funcionando normalmente. O sistema nunca tenta baixar um modelo em runtime.

### Elegibilidade

A Administração oferece somente faixas que ainda precisam de trabalho:

- sem letra efetiva adequada → **Transcrever localmente**;
- letra plain confiável e sem timestamps → **Sincronizar localmente**;
- letra já sincronizada → não entra na lista local.

A transcrição usa os segmentos/timestamps retornados pelo Whisper para formar um candidato LRC. O alinhamento mantém o texto plain existente como autoridade textual e usa a transcrição local apenas para estimar timestamps. Linhas com baixa confiança ou sem match ficam explicitamente marcadas no preview.

Nenhum resultado local é autoaplicável. `local-transcription`, `local-alignment`, alinhamento parcial e baixa confiança são blockers explícitos do fluxo de auto-apply; toda mutação exige revisão humana.

### Pipeline e limites

O processamento segue:

```text
trackId
  → resolução server-side do arquivo físico
  → open/realpath/confinement em MUSIC_DIR
  → cópia para scratch privado fora de MUSIC_DIR
  → FFmpeg: PCM mono 16 kHz
  → Whisper local
  → validação/normalização da saída
  → candidato local privado
  → sugestão do Assistente
  → revisão humana
  → track_lyrics_overrides
```

O runner externo usa `shell: false`, timeout, limite agregado de stdout/stderr, cancelamento por `AbortSignal` e encerramento da árvore de processos. O áudio temporário fica em diretório scratch do sistema com arquivos privados e é removido no `finally`; nenhum áudio derivado é gravado em `MUSIC_DIR`.

Guardrails atuais:

- arquivo de origem limitado defensivamente antes da cópia;
- duração precisa ser conhecida e ficar dentro do limite do serviço;
- modelo local precisa ser arquivo regular legível e tem limite defensivo de tamanho;
- saída JSON do Whisper e saída de processo têm limites próprios;
- conteúdo gerenciado final continua limitado a 48 KiB;
- jobs reutilizam `HeavyWorkQueue`, portanto backpressure/cancelamento seguem a infraestrutura pesada existente;
- não há shell interpolation de título, artista, path ou texto de lyrics.

### Stale protection

Antes de iniciar, o serviço calcula a letra efetiva usada como premissa. Depois do processamento e novamente no apply, um fingerprint SHA-256 dessa representação é comparado ao estado atual.

Se sidecar/override/letra efetiva mudar enquanto o job está rodando ou aguardando revisão, a sugestão local não pode ser aplicada silenciosamente. O administrador precisa executar uma nova tentativa com a premissa atual.

### Proveniência e rollback

Resultados locais são persistidos como `origin: generated` e distinguem `local-transcription` de `local-alignment`. A sugestão registra também versão identificável do executável quando disponível e o nome do modelo sem expor path físico.

Ao aplicar um resultado gerado, o override gerenciado anterior é preservado para um rollback de uma etapa. Remover o resultado local restaura esse override anterior; sem anterior, volta para o sidecar/fallback canônico. Nenhum `.lrc` é criado automaticamente ao lado da música.

## Execução pelo Assistente da Biblioteca

`lyrics` é uma capability independente de `metadata`. O analyzer LRCLIB é registrado no runtime com `capability: 'lyrics'`, portanto uma análise de metadados não executa consultas LRCLIB dentro do mesmo run.

Na Administração, **Analisar biblioteca**, **Analisar mudanças** e a reanálise completa disparam os runs de `metadata` e `lyrics` em paralelo. A tela continua usando a revisão unificada: sugestões prontas de qualquer um dos dois runs e candidatos locais aparecem na mesma fila e seguem a mesma política de aprovação. Cancelar uma análise administrativa cancela os runs ativos de ambas as capabilities; jobs Whisper possuem cancelamento próprio por serem ações explícitas por faixa.

Essa separação mantém métricas, cache, retries e incrementalidade por capability sem criar uma segunda autoridade de revisão.

## Plain e sincronizada

Quando o provider oferece LRC válido, a representação sincronizada é preservada e passa pelo parser já existente. Se não houver LRC válido, uma letra plain válida pode ser usada. Não existe formato proprietário de timestamps.

No alinhamento local, o texto plain existente é mantido linha a linha; somente timestamps são derivados da evidência de reconhecimento. A qualidade expõe cobertura, linhas alinhadas, baixa confiança, não alinhadas, monotonicidade e divergência para revisão.

## Revisão administrativa e rollback

O Assistente mostra a proveniência real da sugestão (`LRCLIB`, transcrição local ou alinhamento local), estado sincronizado, preview limitado e ações Aprovar/Rejeitar. O painel local também mostra aviso de uso de CPU, progresso/cancelamento e qualidade do alinhamento antes da revisão final.

Lote é permitido somente pelo fluxo seguro do Assistente. Itens locais nunca são considerados seguros para auto-apply; se incluídos em lote, exigem confirmação explícita de revisão. Capas continuam com seu fluxo individual próprio.

Uma letra aplicada pode ser removida pela ação de restauração. Para fonte externa sem histórico anterior, isso limpa somente o override gerenciado. Para letra gerada localmente, restaura o override gerenciado anterior quando houver. O histórico da sugestão continua representando a decisão que ocorreu.

## Privacidade, conteúdo e licenciamento

Letras permanecem sujeitas aos direitos de seus autores e titulares. O uso previsto do Home Music é pessoal/self-hosted; a aplicação não expõe uma busca pública irrestrita nem funciona como proxy de catálogo do provider.

Regras de implementação:

- não registrar conteúdo integral de letras em logs;
- não registrar stdout/stderr bruto do Whisper;
- não persistir áudio temporário depois do job;
- não persistir resposta HTTP bruta ou HTML do provider;
- não criar automaticamente `.lrc` dentro de `MUSIC_DIR`;
- não baixar modelo Whisper automaticamente;
- não usar scraping, bypass de login/paywall ou fontes sem permissão adequada;
- fixtures de teste usam somente conteúdo sintético e curto;
- testes do provider e do Whisper local não dependem da internet pública;
- uso comercial futuro exige nova revisão de termos/licenciamento.

## Testes de regressão

A cobertura deve preservar:

- sidecar LRC/TXT e segurança de caminhos;
- prioridade do override gerenciado e fallback após remoção;
- rollback para override anterior depois de resultado gerado;
- plain e synced externos;
- matching forte, duração divergente e candidatos ambíguos;
- provider sem resultado, malformed/oversized, timeout/rate limit por infraestrutura compartilhada;
- stale entre análise e aplicação;
- reopen/cascade/limite do store SQLite;
- runner externo com timeout, output cap e cancelamento;
- fake FFmpeg/Whisper para transcrição e alinhamento sem dependência de binário/modelo real;
- mesma resolução para rota pública/player/offline e OpenSubsonic;
- disparo administrativo separado de `metadata` e `lyrics`, incluindo cancelamento conjunto.
