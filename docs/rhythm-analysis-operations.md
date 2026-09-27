# Operação da análise rítmica

Issue: #505  
Epic: #500

A análise rítmica é enriquecimento derivado. Ela nunca deve bloquear scan, readiness, streaming ou playback.

## Kill switch

A variável:

```bash
HOME_MUSIC_RHYTHM_ANALYSIS_ENABLED=false
```

desliga o scheduler de BPM/beat grid e waveform derivado sem desligar:

- scan da biblioteca;
- streaming original;
- transcoding;
- player normal;
- AutoMix sem análise;
- crossfade sem quantização;
- biblioteca offline já existente.

Configuração inválida também falha de forma conservadora: o DSP derivado é desabilitado e o servidor continua operacional.

## Observabilidade

`GET /api/health` expõe apenas métricas agregadas:

- `configured`;
- `enabled`;
- `analyzerVersion`;
- `pending`;
- `active`;
- `completed`;
- `detected`;
- `unavailable`;
- `decodeUnavailable`;
- `failed`;
- `timeouts`;
- `lowConfidence`;
- `averageDurationMs`;
- `lastDurationMs`.

Não são expostos paths físicos, nomes de faixas ou IDs individuais.

Interpretação prática:

- `pending` crescendo continuamente: backlog maior que a capacidade;
- `active` preso em 1 por muito tempo: investigar FFmpeg/arquivo;
- `timeouts` crescendo: mídia problemática ou host saturado;
- `decodeUnavailable`: arquivo não decodificável pelo FFmpeg atual;
- `lowConfidence`: análise concluída, mas não confiável para sincronização avançada;
- `failed`: falha operacional inesperada, diferente de mídia explicitamente indisponível.

## Fallback funcional

O contrato de playback é degradável:

- sem análise: reprodução normal;
- baixa confidence: sem phase lock;
- BPM incompatível: sem beatmatch;
- crossfade desligado: nenhuma dependência rítmica;
- crossfade ligado sem análise: usa o comportamento temporal normal;
- beat grid inválido: SYNC degrada para tempo/manual;
- erro de análise: readiness e streaming continuam verdes.

## Performance

### Scheduler/backlog sintético

```bash
npm exec tsx apps/server/src/rhythm-analysis-scheduler.benchmark.ts
```

Mede:

- startup com biblioteca já analisada;
- custo de enfileirar backlog;
- drenagem sintética;
- delta de heap;
- 2.000 faixas por padrão.

Para alterar a escala:

```bash
HOME_MUSIC_BENCHMARK_RHYTHM_TRACKS=5000 \
npm exec tsx apps/server/src/rhythm-analysis-scheduler.benchmark.ts
```

### FFmpeg real + transcoding concorrente

```bash
npm exec tsx apps/server/src/rhythm-analysis-ffmpeg.benchmark.ts
```

Mede no mesmo host:

- análise FFmpeg real;
- transcoding real;
- execução isolada;
- execução concorrente;
- wall time;
- CPU do processo Node;
- RSS amostrado;
- razão de slowdown do transcoding.

O benchmark usa áudio sintético e não representa sozinho uma biblioteca real. Comparações devem ser feitas na mesma máquina.

### Waveform e beat grid variável

```bash
npm exec tsx apps/server/src/waveform-analysis.benchmark.ts
npm exec tsx apps/server/src/variable-beat-grid-analysis.benchmark.ts
```

Esses benchmarks ajudam a separar custo de redução/serialização do custo do decoder FFmpeg.

## Matriz funcional já coberta

A regressão automatizada cobre:

- BPM estável;
- downbeat 3/4 e 4/4;
- drift gradual;
- silêncio/ambient sem beat útil;
- faixa curta;
- baixa confidence;
- half/double time;
- seek/cancelamento;
- crossfade desligado;
- crossfade sem análise;
- crossfade quantizado;
- beatmatching aceito e recusado;
- background/foreground;
- falha/timeout sem impacto em readiness;
- scan que conclui sem aguardar DSP;
- análise desabilitada via kill switch.

Arquivos principais:

- `rhythm-analysis.test.ts`;
- `rhythm-analysis-scheduler.test.ts`;
- `rhythm-analysis-resilience.test.ts`;
- `rhythm-analysis-rollout.test.ts`;
- `rhythm-analysis-ffmpeg-benchmark.test.ts`;
- `beatmatch.test.ts`;
- `crossfade.test.ts`;
- `background-playback.test.ts`;
- `dj-sync-calibration.test.ts`.

## Rollout

Sequência recomendada:

1. manter `HOME_MUSIC_RHYTHM_ANALYSIS_ENABLED=true`;
2. observar `/api/health` após startup/rescan;
3. confirmar que backlog converge para zero;
4. investigar crescimento de `failed` ou `timeouts`;
5. comparar benchmark no mesmo hardware após alterações DSP;
6. em regressão operacional, aplicar o kill switch;
7. manter playback disponível enquanto a causa é investigada;
8. reativar e permitir reanálise derivada após correção.

Não há migração destrutiva para desligar/religar a feature. A análise continua derivada e versionada.

## Validação final de playback por superfície

A regressão final da epic #500 combina:

- **mobile**: `rhythm-playback-regression.spec.ts` roda em `mobile-chromium`, remove toda metadata `rhythm` da biblioteca e valida play, seek, pause e resume;
- **desktop**: o mesmo cenário roda em `desktop-chromium`, usando o player normal desktop;
- **PWA/offline**: as suítes existentes de service worker, cold start e coleções offline continuam cobrindo shell/cache/downloads sem depender de análise rítmica nova;
- **crossfade mobile real**: `crossfade-mobile.spec.ts` continua validando dois decks e handoff no Chromium mobile;
- **falha de DSP**: `rhythm-analysis-resilience.test.ts` garante readiness e streaming mesmo quando a análise falha.

O caso novo é deliberadamente executado **sem qualquer `Track.rhythm`**, provando o contrato de fallback da epic em vez de apenas testar o caminho enriquecido.

## Gate

```bash
npm run check
```

O gate cobre testes server/web, incluindo observabilidade, fallback e regressões do player.
