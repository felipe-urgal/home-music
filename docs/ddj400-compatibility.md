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
| EQ LOW/MID/HIGH/FILTER | Implementado em software; mapping físico pendente | #616, #617, #527 |
| Headphone cue avançado | Bloqueado pela decisão do spike físico | #526, #527 |

## Evidência automatizada do mixer (#524)

A issue #524 fica coberta sem depender de hardware físico:

- channel faders A/B independentes: `ddj400-mixer-mapping.test.ts` + E2E do Modo DJ;
- crossfader normalizado em `-1..1`: `ddj400-mixer-mapping.test.ts`;
- curva equal-power, centro e extremos: `dual-deck-mixer.test.ts`;
- composição master × channel × crossfader sem clipping: `dual-deck-mixer.test.ts`;
- mudanças rápidas sem misturar estado entre controles: `ddj400-mixer-mapping.test.ts`;
- ao entrar em AutoMix, os channel faders voltam a 100% e o crossfader mantém a posição atual; ao retornar para Manual, A/B e crossfader voltam a responder: `dj-mode-regressions.spec.ts`;
- saída do Modo DJ remove a superfície do mixer e retorna ao player normal: `dj-mode-regressions.spec.ts`;
- player comum continua coberto pelo gate desktop.

A validação física da DDJ-400 continua relevante para compatibilidade de hardware da epic #518/#528, mas não é critério de fechamento da #524.

## Evidência automatizada de feedback MIDI (#525)

A cobertura sem hardware físico agora inclui:

- bytes PLAY/CUE/SYNC e estados ON/OFF: `ddj400-led-feedback.test.ts`;
- deduplicação de renders idênticos: `ddj400-led-feedback.test.ts`;
- reidratação após reset/reconnect: `ddj400-led-feedback.test.ts`;
- ausência de output sem quebrar o player: `ddj400-led-feedback.test.ts`;
- transições PLAY/PAUSE iniciadas pela UI gerando bytes no `MIDIOutput` simulado: `dj-mode-regressions.spec.ts`;
- CUE iniciado pela UI gerando feedback LED no output simulado: `dj-mode-regressions.spec.ts`;
- troca de output limpando a porta anterior e reidratando a nova: `dj-mode-regressions.spec.ts`;
- reconnect da sessão MIDI gerando nova hidratação no output simulado: `dj-mode-regressions.spec.ts`;
- playback continua funcional durante disconnect/reconnect: `dj-mode-regressions.spec.ts`.

A homologação física dos LEDs permanece pendente na DDJ-400 real e continua sendo critério de #525/#528.

## Evidência automatizada de performance DDJ (#523)

A cobertura sem hardware físico agora inclui também:

- pitch 14-bit independente por deck e faixa documentada de ±6%: `ddj400-performance-mapping.test.ts`;
- extremos convertidos para aproximadamente `1.06x` e `0.94x`: `ddj400-performance-mapping.test.ts`;
- pitch vindo do input MIDI simulado alterando o rate real do Deck A e refletindo imediatamente na UI: `dj-mode-regressions.spec.ts`;
- centralização do pitch retornando o deck para `1.000x`: `dj-mode-regressions.spec.ts`;
- burst de jog sem acumular estado inválido: `ddj400-performance-mapping.test.ts`;
- SYNC continua reutilizando a fundação rítmica existente, sem algoritmo paralelo.

O QA físico de pitch, jog e SYNC continua pendente na #523/#528.

## Evidência automatizada do mapping básico (#522)

A cobertura sem hardware físico agora inclui:

- browser rotary alterando a seleção da biblioteca via input MIDI simulado: `dj-mode-regressions.spec.ts`;
- LOAD esquerdo e direito carregando Deck A/B a partir da seleção feita pelo browser MIDI: `dj-mode-regressions.spec.ts`;
- PLAY/PAUSE independente por deck: `dj-mode-regressions.spec.ts` + `ddj400-mapping.test.ts`;
- CUE via MIDI no Deck B sem alterar o playback do Deck A: `dj-mode-regressions.spec.ts`;
- note-off/velocity zero não duplica LOAD, PLAY ou CUE: `dj-mode-regressions.spec.ts` + `ddj400-mapping.test.ts`;
- fixtures nomeadas e bytes do MVP: `ddj400-midi-fixtures.test.ts`;
- eventos desconhecidos ignorados: `ddj400-mapping.test.ts`;
- player normal continua coberto pelo gate desktop.

A homologação física da DDJ-400 continua pendente e permanece critério da #522/#528.

## Evidência automatizada do EQ (#527)

A parte de software que não depende da DDJ-400 física agora inclui:

- LOW / MID / HIGH e FILTER independentes por deck;
- faixa normalizada e neutralidade central testadas;
- graph Web Audio único por deck, sem rebuild a cada movimento;
- atualização direta de parâmetros;
- cleanup do `AudioContext`;
- fallback quando Web Audio não existe ou a criação do graph falha;
- troca de faixa preserva a posição dos knobs do mixer;
- sair e reentrar no Modo DJ restaura o EQ neutro;
- player normal continua coberto pela regressão E2E.

Continuam dependentes de hardware real:

- bytes/mapping MIDI dos knobs LOW/MID/HIGH/FILTER;
- CPU/latência percebida no ambiente alvo;
- saída master/headphones e headphone CUE separados.

## Matriz de homologação física

Preencher somente quando a controladora estiver disponível.

| Data | OS / versão | Browser / versão | Web MIDI | Input | Output | Áudio DDJ | Master separado | Headphones separado | Limitações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pendente | — | — | — | — | — | — | — | — | DDJ-400 física indisponível no momento |

## Regra de status

- **Implementado em software**: código e testes automatizados existem; não afirma compatibilidade física.
- **Validado fisicamente**: comportamento observado na DDJ-400 real e ambiente registrado.
- **Pendente**: nenhuma conclusão deve ser inferida.
