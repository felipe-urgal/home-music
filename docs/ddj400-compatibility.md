# Compatibilidade Pioneer DDJ-400

Esta matriz acompanha a epic #518. Resultados físicos só devem ser preenchidos após teste real; ausência de teste não significa incompatibilidade.

| Item | Estado atual | Evidência |
| --- | --- | --- |
| Web MIDI disponível em contexto seguro | Implementado em software | testes de `web-midi.ts` |
| MIDI input | Implementado em software; físico pendente | #521, #522 |
| MIDI output / LEDs | Implementado em software; físico pendente | #525 |
| Browser / LOAD / PLAY / CUE | Implementado em software; físico pendente | #522 |
| Pitch / jog / sync | Implementado em software; físico pendente | #523 |
| Channel faders / crossfader | Implementado em software; físico pendente | #524 |
| Áudio pela DDJ-400 | Pendente de teste físico | #526 |
| Master separado | Pendente de teste físico | #526 |
| Headphones/cue separado | Pendente de teste físico | #526 |
| EQ / headphone cue avançado | Bloqueado pela decisão do spike | #527 |

## Evidência automatizada do mixer (#524)

A issue #524 fica coberta sem depender de hardware físico:

- channel faders A/B independentes: `ddj400-mixer-mapping.test.ts` + E2E do Modo DJ;
- crossfader normalizado em `-1..1`: `ddj400-mixer-mapping.test.ts`;
- curva equal-power, centro e extremos: `dual-deck-mixer.test.ts`;
- composição master × channel × crossfader sem clipping: `dual-deck-mixer.test.ts`;
- mudanças rápidas sem misturar estado entre controles: `ddj400-mixer-mapping.test.ts`;
- ao entrar em AutoMix, o mixer manual volta ao neutro; ao retornar para Manual, os controles A/B e crossfader voltam a responder: `dj-mode-regressions.spec.ts`;
- saída do Modo DJ remove a superfície do mixer e retorna ao player normal: `dj-mode-regressions.spec.ts`;
- player comum continua coberto pelo gate desktop.

A validação física da DDJ-400 continua relevante para compatibilidade de hardware da epic #518/#528, mas não é critério de fechamento da #524.

## Matriz de homologação física

Preencher somente quando a controladora estiver disponível.

| Data | OS / versão | Browser / versão | Web MIDI | Input | Output | Áudio DDJ | Master separado | Headphones separado | Limitações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pendente | — | — | — | — | — | — | — | — | DDJ-400 física indisponível no momento |

## Regra de status

- **Implementado em software**: código e testes automatizados existem; não afirma compatibilidade física.
- **Validado fisicamente**: comportamento observado na DDJ-400 real e ambiente registrado.
- **Pendente**: nenhuma conclusão deve ser inferida.
