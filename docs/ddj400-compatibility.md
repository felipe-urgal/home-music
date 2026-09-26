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

## Matriz de homologação física

Preencher somente quando a controladora estiver disponível.

| Data | OS / versão | Browser / versão | Web MIDI | Input | Output | Áudio DDJ | Master separado | Headphones separado | Limitações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pendente | — | — | — | — | — | — | — | — | DDJ-400 física indisponível no momento |

## Regra de status

- **Implementado em software**: código e testes automatizados existem; não afirma compatibilidade física.
- **Validado fisicamente**: comportamento observado na DDJ-400 real e ambiente registrado.
- **Pendente**: nenhuma conclusão deve ser inferida.
