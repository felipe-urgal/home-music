# Pioneer DDJ-400 no Home Music

Suporte em desenvolvimento ligado à epic #518.

## Pré-requisitos

- navegador com Web MIDI;
- contexto seguro (HTTPS ou ambiente local compatível);
- DDJ-400 conectada por USB;
- permissão MIDI concedida ao site.

## Conectar

1. Conecte a DDJ-400.
2. Abra **Minha conta → Controlador MIDI**.
3. Clique em **Conectar controlador**.
4. Escolha a DDJ-400 em **Entrada MIDI**.
5. Quando quiser feedback de LEDs, escolha também a DDJ-400 em **Saída MIDI**.

A ausência de saída MIDI não deve impedir playback nem controles de entrada.

## Controles implementados em software

- browser encoder;
- LOAD A/B;
- PLAY/PAUSE A/B;
- CUE mínimo A/B;
- pitch/tempo;
- jog como scrub/nudge;
- beat sync;
- channel faders;
- crossfader;
- LEDs de PLAY, CUE e SYNC.

Scratch real não faz parte do MVP atual.

## Áudio, master e headphones

A DDJ-400 como interface de áudio ainda depende do spike físico #526. O Home Music não anuncia headphone cue separado até existir evidência de isolamento real entre master e headphones.

O spike manual está documentado em `docs/ddj400-audio-spike.md`.

## Diagnóstico

Em **Minha conta → Controlador MIDI**, ative **Diagnóstico local** para ver somente o último evento MIDI normalizado.

Ao registrar um problema, informe:

- OS e versão;
- browser e versão;
- nome exibido da entrada/saída MIDI;
- controle usado;
- último evento mostrado no diagnóstico;
- se o problema ocorre após desconectar/reconectar USB.

Não é necessário enviar biblioteca, nomes de músicas ou outros dados pessoais para diagnosticar o mapping MIDI.

## Troubleshooting

### Web MIDI indisponível

- confirme HTTPS/contexto seguro;
- use um navegador com Web MIDI;
- confira se a permissão MIDI foi bloqueada.

### Controlador aparece, mas não responde

- confira a entrada MIDI selecionada;
- desconecte/reconecte o USB;
- reabra a seleção da porta após hot-plug se necessário.

### LEDs não acompanham

- confirme que uma saída MIDI está selecionada;
- entrada e saída são configurações independentes;
- alterações de LED não devem afetar playback caso a saída esteja ausente.

### Headphones não funcionam separados do master

Ainda não tratar como bug do mapping MIDI. Essa capacidade depende da validação física de áudio da #526.
