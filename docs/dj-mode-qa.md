# QA do Modo DJ

Issue: #549  
Epic: #543

Este roteiro separa a regressão automatizada da homologação visual/física. O CI não depende de uma DDJ-400 real.

## Cobertura automatizada

O E2E `e2e/tests/dj-mode-regressions.spec.ts` executa em Chromium desktop e valida:

- entrada explícita no Modo DJ;
- Deck A e Deck B vazios ao iniciar;
- biblioteca com as fixtures reais do runner;
- LOAD independente em A e B;
- estado dos decks refletido na UI;
- channel faders A/B;
- crossfader manual;
- conexão Web MIDI com `MIDIAccess` simulado;
- seleção de input/output;
- PLAY do Deck A via bytes DDJ-400 simulados;
- note-off/velocity zero sem ação dupla;
- desconexão MIDI sem interromper os decks;
- alternância Manual/AutoMix;
- saída do Modo DJ;
- retorno ao player normal mantendo a faixa principal.

A simulação MIDI exercita a mesma camada Web MIDI/mapping usada em produção, sem exigir hardware no runner.

## Cobertura unitária relacionada

A regressão do Modo DJ também depende das suítes existentes:

- `dj-controller-contract.test.ts`;
- `dual-deck-audio.test.ts`;
- `dual-deck-mixer.test.ts`;
- `ddj400-mapping.test.ts`;
- `ddj400-performance-mapping.test.ts`;
- `ddj400-mixer-mapping.test.ts`;
- `ddj400-led-feedback.test.ts`;
- `web-midi.test.ts`;
- `midi-port-selection.test.ts`;
- `dj-keyboard-mapping.test.ts`;
- `dj-session-policy.test.ts`;
- `background-playback.test.ts`;
- `dj-sync-*.test.ts`;
- `dj-automix-*.test.ts`.

## Gate

O gate principal continua sendo:

```bash
npm run check
```

O workflow também executa o E2E do Modo DJ junto do gate desktop:

```bash
npm run test --prefix e2e -- \
  tests/desktop-layout-regressions.spec.ts \
  tests/dj-mode-regressions.spec.ts \
  --project=desktop-chromium
```

## Roteiro visual

Executar em desktop com largura >= 1280 px:

1. abrir o player normal e registrar faixa/estado atual;
2. abrir Modo DJ pela barra superior;
3. confirmar que nenhum elemento do player normal sobrepõe a superfície DJ;
4. carregar faixas diferentes em A e B;
5. confirmar título, waveform, tempo, BPM e controles por deck;
6. mover channel faders e crossfader rapidamente;
7. alternar Manual e AutoMix;
8. trocar pasta/playlist e confirmar que a listagem respeita a origem;
9. usar busca;
10. confirmar marcação visual de faixas já tocadas;
11. abrir/fechar o editor de beat grid;
12. conectar/desconectar MIDI quando disponível;
13. sair do Modo DJ;
14. confirmar retorno previsível ao player normal.

## Roteiro físico DDJ-400

Quando houver controladora disponível:

1. conectar a DDJ-400;
2. selecionar input/output MIDI;
3. navegar pela biblioteca com encoder;
4. LOAD A e LOAD B;
5. PLAY/CUE de ambos os decks;
6. pitch, jog e SYNC;
7. channel faders e crossfader;
8. conferir feedback visual imediato na UI;
9. alterar estado pela UI e conferir LEDs;
10. desconectar e reconectar USB durante playback;
11. sair do Modo DJ e confirmar player normal funcional.

A homologação física pertence à epic #518/#528; ela não bloqueia o CI da interface #549.
