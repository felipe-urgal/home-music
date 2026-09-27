# Calibração de waveform, beat grid e SYNC

Status da issue: #573  
Epic: #564

Este documento concentra os limites de tolerância, a cobertura automatizada e o roteiro de QA real do Modo DJ. Valores abaixo descrevem o contrato atual; mudanças nos controladores de SYNC devem atualizar testes e este documento no mesmo PR.

## Tolerâncias automatizadas

| Métrica | Limite atual | Evidência |
| --- | ---: | --- |
| BPM sintético estável | erro absoluto <= 1 BPM; 174 BPM aceita half-time 87 BPM como ambiguidade explícita | `rhythm-analysis.test.ts` |
| primeiro beat sintético | erro absoluto <= 40 ms | `rhythm-analysis.test.ts` |
| downbeat 3/4 e 4/4 | erro absoluto <= 40 ms | `rhythm-analysis.test.ts` |
| deadband de phase lock | 12 ms | `DJ_SYNC_PHASE_DEADBAND_SECONDS` |
| nudge inicial | erro de fase <= 80 ms | `DJ_SYNC_NUDGE_MAX_SECONDS` |
| seek inicial | correção de mídia <= 1,5 s | `DJ_SYNC_MAX_INITIAL_SEEK_SECONDS` |
| nudge contínuo | até 1,2% sobre o rate base | `DJ_SYNC_CONTINUOUS_MAX_RATE_DELTA` |
| re-lock contínuo | erro entre 100 e 220 ms, com cooldown de 1 s | `dj-sync-continuous-lock.ts` |
| erro inseguro | > 220 ms degrada para tempo-only | `dj-sync-continuous-lock.ts` |
| phase lock 30/60/120 s | <= 16 ms na simulação com drift leve | `dj-sync-calibration.test.ts` |
| waveform persistido | 1024 peaks por faixa longa, normalizados em 0..1 | `waveform-analysis.ts` |

A margem de 16 ms na simulação longa é deliberadamente um pouco maior que a deadband de 12 ms porque a amostragem do controlador ocorre a cada 80 ms.

## Matriz sintética

A suíte automatizada cobre:

- 60 BPM;
- 90 BPM;
- 120 BPM;
- 128 BPM;
- 140 BPM;
- 174 BPM com ambiguidade half-time explicitamente aceita/medida;
- offsets conhecidos de fase;
- compassos 3/4 e 4/4;
- downbeat conhecido;
- intro longa sem bateria;
- silêncio;
- baixa confidence;
- half/double time;
- drift gradual;
- mudança de BPM por segmento;
- phase lock em ambos os sentidos;
- estabilidade de 30 s, 60 s e 120 s;
- override manual como grid efetivo.

Arquivos principais:

- `apps/server/src/rhythm-analysis.test.ts`;
- `apps/server/src/variable-beat-grid-analysis.test.ts`;
- `apps/server/src/waveform-analysis.test.ts`;
- `apps/web/src/dj-beat-grid.test.ts`;
- `apps/web/src/dj-sync-phase-lock.test.ts`;
- `apps/web/src/dj-sync-continuous-lock.test.ts`;
- `apps/web/src/dj-sync-calibration.test.ts`;
- `apps/web/src/dj-sync-state.test.ts`;
- `apps/web/src/dj-waveform-grid.test.ts`.

## Política de degradação

O SYNC não força phase lock quando o grid não é confiável.

- confidence rítmica abaixo do contrato: tempo-only ou modo manual;
- downbeat sem confidence suficiente: beat lock, sem bar lock;
- half/double time: beat lock sem presumir alinhamento de compasso;
- erro contínuo acima de 220 ms: tempo-only;
- mudança manual de pitch/nudge: cancela o estado de SYNC daquele deck;
- LOAD ou indisponibilidade de deck: limpa master/slave obsoleto;
- beat grid variável: usa BPM local do segmento ativo;
- override manual: substitui o ritmo efetivo sem apagar a análise automática.

## Performance e tamanho

Os benchmarks existentes continuam sendo a fonte para custo computacional:

```bash
npm exec tsx apps/server/src/waveform-analysis.benchmark.ts
npm exec tsx apps/server/src/variable-beat-grid-analysis.benchmark.ts
npm exec tsx apps/server/src/rhythm-analysis-ffmpeg.benchmark.ts
```

Registrar, quando executado em uma máquina de referência:

- CPU média e pico durante análise;
- tempo de análise FFmpeg;
- tempo de redução do waveform;
- quantidade de segmentos do beat grid variável;
- tamanho JSON do grid;
- latência de render do waveform no navegador;
- quantidade de nudges/re-locks durante 30/60/120 s.

Esses números são dependentes de hardware/browser e não devem virar limite rígido de CI sem uma máquina de benchmark controlada.

## QA com faixas reais

Usar pelo menos uma faixa de cada categoria:

| Categoria | O que observar |
| --- | --- |
| house/techno/EDM | BPM, primeiro beat, estabilidade do lock |
| hip-hop | half/double time e fase |
| drum and bass | 174 BPM, ambiguidade half-time |
| pop | downbeat e transições |
| rock | tolerância a bateria humana |
| live | drift e re-lock |
| disco/funk antigo | drift gradual |
| ambient | degradação sem beat confiável |

Para cada faixa registrar:

- BPM detectado versus referência manual;
- erro do primeiro beat;
- erro do downbeat;
- modo escolhido: tempo/beat/bar;
- erro de fase logo após SYNC;
- erro de fase em 30/60/120 s;
- quantidade aproximada de nudges/re-locks;
- necessidade ou não de override manual.

Não adicionar arquivos musicais comerciais ao repositório.

## Roteiro funcional

Executar no navegador real:

1. carregar A e B com BPM compatíveis;
2. SYNC A -> B e confirmar master/slave;
3. desfazer e testar B -> A;
4. pausar e retomar slave;
5. fazer seek e confirmar recuperação previsível;
6. usar CUE;
7. fazer LOAD de outra faixa e confirmar limpeza de estado anterior;
8. alterar pitch manual e confirmar cancelamento do SYNC daquele deck;
9. usar nudge/jog e confirmar retorno ao rate base;
10. testar AutoMix;
11. testar repeat fora do modo DJ e confirmar ausência de estado fantasma;
12. conferir waveform e beat grid visualmente;
13. aplicar override manual e confirmar que waveform, SYNC e AutoMix usam o novo grid;
14. restaurar automático e confirmar retorno à análise persistida.

## QA físico DDJ-400

A homologação física não pode ser inferida por fixtures MIDI. Executar com DDJ-400 real:

1. conectar input e output MIDI;
2. carregar duas faixas por LOAD A/B;
3. testar SYNC A -> B e B -> A;
4. trocar master;
5. usar pitch e jog/nudge durante SYNC;
6. pausar/retomar;
7. usar CUE;
8. trocar faixa durante SYNC;
9. conferir LEDs de SYNC após cada transição;
10. desconectar/reconectar USB durante playback;
11. repetir com faixa de beat grid variável;
12. repetir com faixa que recebeu override manual.

Registrar OS, browser/versão, firmware quando disponível e divergências de comportamento.

Até esse roteiro ser executado em hardware real, o critério “QA físico registrado” da #573 permanece pendente.

## Gate de conclusão

Automatizado:

```bash
npm run check
```

Além disso, o CI deve manter verdes os gates de segurança, E2E desktop/mobile e Android TV já existentes quando forem acionados.

A #573 só deve ser encerrada quando o QA físico DDJ-400 acima também estiver registrado.
