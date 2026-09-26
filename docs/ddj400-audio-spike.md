# Spike DDJ-400 — saída de áudio, master e headphones

Issue: #526

Este spike é deliberadamente isolado do player de produção. A conclusão arquitetural depende de teste físico com uma Pioneer DDJ-400 real.

## Como executar

1. Suba o frontend normalmente:

       npm run dev -w @home-music/web

2. Abra em contexto seguro:

       https://<host>/spikes/ddj400-audio-output.html

   Em desenvolvimento local, `localhost` pode ser tratado como contexto seguro pelo browser, mas para teste real em outra máquina prefira HTTPS.

3. Conecte a DDJ-400 por USB.
4. Clique em **Enumerar outputs**.
5. Use **Selecionar saída master** e selecione a saída desejada.
6. Use **Selecionar saída cue** e selecione a saída desejada.
7. Toque 440 Hz no master e 660 Hz no cue.
8. Verifique fisicamente se os sinais chegam a destinos realmente separados.
9. Registre observações e copie o relatório JSON.

## O que observar

- OS e versão;
- browser e versão;
- nome apresentado pela DDJ-400;
- quantidade de `audiooutput` expostos;
- suporte a `MediaDevices.selectAudioOutput()`;
- suporte a `HTMLMediaElement.setSinkId()`;
- suporte a `AudioContext.setSinkId()`;
- se master e headphones aparecem como sinks separados;
- se dois elementos `<audio>` conseguem usar sinks diferentes ao mesmo tempo;
- latência perceptível;
- reconexão USB;
- erros `NotAllowedError`, `NotFoundError` ou `AbortError`.

A Audio Output Devices API exige contexto seguro; seleção explícita pode exigir ativação do usuário e permissão. `speaker-selection` também pode bloquear enumeração/seleção.

## Critério de decisão

Só depois do teste físico classificar:

- suportado no browser alvo;
- parcialmente suportado;
- exige helper/app nativo;
- não viável no escopo web atual.

Não concluir suporte a headphone cue apenas porque a DDJ-400 aparece como um único dispositivo de saída. É necessário comprovar isolamento real entre master e cue.
