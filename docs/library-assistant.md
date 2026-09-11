# Assistente da Biblioteca

Este documento descreve o comportamento **corrente** do Assistente da Biblioteca após a conclusão da Fase 15.

## Objetivo

O Assistente reduz trabalho repetitivo de manutenção sem criar uma segunda biblioteca nem uma nova autoridade de metadata, capa ou letra. Ele analisa o estado efetivo, coleta evidências, produz sugestões explicáveis e aplica somente pelas autoridades existentes.

Fluxo geral:

```text
biblioteca efetiva
      ↓
análise por capability
      ↓
evidências + candidatos + confiança
      ↓
política de revisão
      ↓
revalidação/stale protection
      ↓
autoridade canônica do domínio
```

## Capacidades implementadas

O Assistente cobre:

- identificação de `title`, `artist`, `album` e `albumArtist` com MusicBrainz;
- artwork via Cover Art Archive quando existe release confiável;
- lyrics via LRCLIB em run independente;
- revisão individual e lote explícito de metadata/lyrics;
- normalização assistida de artista/álbum reutilizando aliases existentes;
- Chromaprint/`fpcalc` + AcoustID opcional para casos difíceis;
- transcrição/alinhamento local opcional com Whisper/whisper.cpp;
- autonomia progressiva opt-in após scan/importação;
- reset operacional de sugestões abertas;
- fila, métricas e histórico de runs;
- preferências de revisão/configuração sem reduzir as invariantes do backend.

## Autoridades preservadas

O Assistente é um orquestrador. As fontes de verdade continuam sendo:

- `MUSIC_DIR` + scanner para o estado físico;
- `LibraryService` e a projeção administrativa para o snapshot efetivo;
- `TrackMetadataOverrideStore` para correções textuais por faixa;
- normalização/aliases existentes para decisões globais de artista/álbum;
- `TrackCoverOverrideStore` para capa efetiva;
- domínio canônico de lyrics para letra publicada;
- `HeavyWorkQueue`/observabilidade existentes para trabalho pesado.

As tabelas `library_assistant_*` guardam estado derivado, auditável e operacional. Elas não substituem `tracks`.

## Runs e capabilities

`metadata` e `lyrics` são capabilities independentes. A Administração pode iniciá-las em paralelo e cancelar os runs ativos em conjunto.

O lifecycle de run inclui estados como:

```text
queued → running → completed
                 ├→ failed
                 ├→ cancelled
                 └→ stale
```

Cada run captura a revisão da biblioteca efetiva. Sugestões recebem assinatura da premissa relevante; mudança de biblioteca ou decisão humana pode torná-las `stale` antes do apply.

## Identificação com MusicBrainz

MusicBrainz é evidência externa, não autoridade. A integração é server-side e passa pelo gateway compartilhado de providers, com:

- User-Agent identificável;
- rate limit;
- timeout e cancelamento;
- cache derivado/versionado;
- normalização/limite de payload;
- testes sem dependência da internet pública.

O matcher considera título, artista, álbum, `albumArtist`, duração, contexto coletivo e IDs externos. Conflitos fortes bloqueiam a sugestão. Filename pode servir de evidência auxiliar somente de forma conservadora; path físico nunca é enviado ao provider.

## Artwork

Quando uma identificação fornece release/release-group confiável, o Assistente pode sugerir artwork do Cover Art Archive.

Regras:

- a imagem não é baixada durante a análise;
- o apply é individual;
- download/egress/redirect/MIME/bytes/dimensões seguem a validação de cover existente;
- override humano existente exige decisão explícita para substituição;
- a persistência usa `TrackCoverOverrideStore`;
- nenhuma capa é escrita dentro do arquivo de áudio.

A identidade sem capa e a projeção para Media Session são documentadas em [`artwork-fallback.md`](artwork-fallback.md).

## Lyrics

LRCLIB roda em capability `lyrics` própria. A sugestão armazena identidade, proveniência e preview curto; o conteúdo completo é buscado novamente no apply e validado antes de persistir.

A resolução publicada continua única:

```text
override gerenciado aprovado
        ↓
sidecar .lrc/.txt
        ↓
nenhuma letra
```

Player, offline e OpenSubsonic usam essa mesma cadeia. Detalhes: [`lyrics.md`](lyrics.md).

## Whisper/whisper.cpp local

O fallback local é opcional e nunca participa do playback em tempo real.

Ele oferece:

- **transcrição local** quando não existe letra efetiva adequada;
- **alinhamento local** quando existe texto plain confiável sem timestamps.

O pipeline resolve o arquivo por `trackId` no servidor, valida confinement/arquivo regular, copia para scratch privado fora de `MUSIC_DIR`, prepara PCM via FFmpeg e executa Whisper sem shell livre.

Resultados locais:

- nunca são autoaplicados;
- exigem revisão humana;
- carregam proveniência `local-transcription` ou `local-alignment`;
- usam fingerprint da letra efetiva para stale protection;
- preservam uma versão gerenciada anterior para rollback quando aplicável;
- não criam `.lrc` automaticamente dentro da biblioteca.

## Fingerprint acústico

Para metadata difícil, o administrador pode usar Chromaprint/`fpcalc` local e AcoustID opcional.

O fluxo:

```text
trackId
  ↓
resolução física confinada
  ↓
fpcalc local
  ↓
AcoustID opcional
  ↓
recording IDs
  ↓
matcher MusicBrainz já existente
  ↓
review normal do Assistente
```

O fingerprint é evidência adicional e não cria um segundo matcher. AcoustID exige opt-in/configuração explícita; segredo fica somente no servidor.

## Normalização

O Assistente pode enriquecer a normalização de artista/álbum com evidências MusicBrainz já persistidas, mas a autoridade de alias existente continua única.

Não criar centenas de overrides por faixa quando o problema é corretamente uma decisão global de normalização.

## Revisão e lote

A política de revisão pode classificar tipos como `ignore`, `review` ou `bulk` quando suportado. Artwork permanece individual.

Aplicação em lote:

- exige seleção/decisão explícita;
- aceita no máximo o limite definido pelo contrato por request;
- pode ser dividida em chunks pela Web;
- preserva sucesso parcial e diagnóstico por item;
- revalida cada sugestão no backend;
- não desliga stale protection;
- não transforma revisão humana em auto-apply permanente.

Decisão humana explícita vence automação e override existente nunca é sobrescrito silenciosamente.

## Autonomia progressiva

A autonomia é opt-in e conservadora. Eventos consistentes de scan/importação podem iniciar análise incremental, mas o Assistente continua sujeito às mesmas regras de confiança, revalidação e autoridades.

O fluxo manual permanece disponível como fallback. Desabilitar autonomia não desabilita o Assistente.

## Reset operacional

`Limpar e reanalisar tudo` invalida somente sugestões abertas/revisáveis por `stale`, preservando histórico, `applied` e `rejected`. O reset não apaga decisões já aplicadas e é recusado quando existe análise conflitante ativa.

## Segurança e privacidade

Invariantes:

- `/api/admin/*` continua restrito a admin;
- mutações preservam a proteção anti-CSRF vigente;
- providers recebem somente campos mínimos necessários;
- path físico, cookie, token, segredo e conteúdo desnecessário não saem do servidor;
- payload externo é limitado e validado;
- processos locais usam programa + argumentos com `shell: false`;
- scratch/arquivos temporários são limpos;
- letras completas e stdout/stderr bruto do Whisper não entram em logs;
- testes de providers/Whisper usam fakes/fixtures e não dependem da internet pública.

## Estado da Fase 15

A Fase 15 e a umbrella #310 estão encerradas. As entregas #311, #312, #313, #314, #315, #316, #318, #319, #320, #321, #322, #325, #326, #327, #328 e #356 foram incorporadas.

As validações físicas residuais de #325/#327/#328 foram dispensadas como gate de encerramento por decisão do projeto e aceitas como risco de plataforma. Isso não deve ser interpretado como evidência de teste em hardware.

Novas capacidades devem ser abertas como nova issue/fase em vez de reabrir a Fase 15.
