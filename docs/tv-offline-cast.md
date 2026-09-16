# Transmissão de downloads do celular para a TV

## Objetivo

O Home Music pode enviar uma faixa já baixada no navegador do celular diretamente para a experiência TV. O servidor continua responsável por autenticação, ownership da sessão remota e sinalização WebRTC, mas **não transporta bytes de áudio**.

A primeira versão é deliberadamente complementar ao controle remoto existente: o celular continua abrindo `/remote/<sessionId>`, a TV continua dona do player canônico e o APK Android TV continua apenas carregando o frontend no GeckoView.

## Fluxo

```text
Celular autenticado                         TV autenticada
┌─────────────────────────────┐             ┌─────────────────────────────┐
│ /remote/<sessionId>         │             │ ?tv=1                      │
│ Cache Storage offline       │             │ useCrossfadeAudioPlayer    │
│ RTCPeerConnection           │◄───────────►│ RTCPeerConnection           │
│ RTCDataChannel              │ áudio P2P   │ Blob + object URL          │
└──────────────┬──────────────┘             └──────────────┬──────────────┘
               │ offer/answer/ICE                           │
               └────────────────┬───────────────────────────┘
                                ▼
                       sessão remota no servidor
                       (sinalização somente)
```

1. a rota remota do celular cria o peer iniciador e um DataChannel `home-music-media-v1`;
2. offer/answer/ICE usam a sessão remota autenticada e o SSE já existente;
3. quando `play-track` aponta para uma faixa baixada neste celular e o canal P2P está aberto, o cliente lê a resposta física do Cache Storage do usuário atual;
4. a faixa é enviada em chunks de 64 KiB com backpressure;
5. a TV valida quantidade de bytes, monta um `Blob`, cria um object URL transitório e confirma `media-ready`;
6. somente após a confirmação, o celular publica o comando `play-track` normal;
7. o `useCrossfadeAudioPlayer` encontra a fonte transitória e a adota no mesmo player/decks já usados pela TV.

Se a faixa não estiver baixada ou o canal P2P ainda não estiver pronto, o comando mantém o comportamento online atual e a TV busca a fonte pelo servidor.

## Armazenamento offline do celular

Nenhuma cópia adicional é criada. O envio reutiliza:

```text
home-music-offline-audio-v2-<userId>
```

A entrada física continua sendo a request canônica:

```text
/api/tracks/<trackId>/stream
```

O manifesto `home-music:offline-tracks:v2:<userId>` permanece a projeção lógica do download. A leitura para transmissão exige o usuário offline atual, resposta `200`, MIME `audio/*`, conteúdo não vazio e tamanho dentro do limite.

## Protocolo de mídia

Mensagens de controle do DataChannel:

- `media-start`: `transferId`, `trackId`, `mimeType`, `size`;
- chunks binários: pertencem à transferência ativa;
- `media-complete`: fim dos chunks;
- `media-ready`: TV recebeu, validou e preparou a fonte;
- `media-cancel`: cancela/limpa a transferência ativa.

Limites atuais:

- chunk: 64 KiB;
- máximo por faixa: 256 MiB;
- high-water de envio: 1 MiB;
- low-water: 512 KiB;
- confirmação da TV: até 30 s;
- uma transferência ativa por canal.

A TV só confirma `media-ready` depois que `onReceive` conclui. Assim `play-track` não corre à frente da fonte local.

## Player e lifecycle da TV

A mídia recebida **não vira download offline da TV**. Ela é mantida como fonte transitória por `trackId`:

- `URL.createObjectURL(blob)` ao receber;
- substituição revoga o URL anterior daquela faixa;
- encerramento/regeneração da sessão e unmount revogam todos os URLs;
- reprodução manual e preparação do segundo deck de crossfade consultam primeiro a fonte P2P;
- sem fonte P2P, o resolvedor existente continua usando offline local da própria superfície ou streaming online.

Não existe segundo `<audio>`, segundo estado de fila ou player paralelo.

## Segurança e isolamento

- endpoints de sinalização usam a autenticação normal da sessão;
- ownership da sessão remota é aplicado pelo backend;
- mutações preservam `X-Home-Music-Request: 1`;
- SDP e ICE possuem validação e limites de tamanho;
- sinais próprios são ignorados pelo peer;
- bytes de áudio nunca entram no backend;
- cache offline continua namespaced pelo usuário autenticado no dispositivo;
- a rota remota continua sem `<audio>` local.

## Limitações da primeira versão

A primeira versão **não é pareamento offline total**. Para criar/manter a sessão e trocar sinalização, celular e TV ainda precisam alcançar a mesma instalação Home Music. O objetivo coberto é evitar que o arquivo de áudio precise estar disponível no servidor/caminho de streaming quando ele já existe no celular.

Também ficam fora de escopo:

- discovery/pairing puramente LAN sem backend;
- TURN para atravessar redes diferentes;
- MediaSource/streaming progressivo antes da faixa completa;
- persistir automaticamente a faixa recebida na TV;
- alterar o APK ou criar bridge JavaScript nativa.

## Offline total pela LAN

A fase seguinte mantém o mesmo protocolo binário e player, mas substitui a sinalização online por uma sessão LAN efêmera. O PWA continua na origin Home Music para preservar Cache Storage; o APK serve o receiver embarcado por loopback. Depois de abrir o DataChannel, mídia, comandos e snapshots trafegam diretamente entre celular e TV, sem REST/SSE do Home Music.

Frames textuais usam `home-music-data-v1`; chunks de áudio continuam binários. `sendTrackAndPlay` aguarda `media-ready` antes de publicar `play-track`, e a TV permanece autoridade do playback. Faixa ausente no cache falha explicitamente, sem fallback online no modo LAN.

O modo anterior continua disponível quando o servidor está acessível; não há troca automática entre sessões online e LAN.

## Testes automatizados

A cobertura inclui:

- validação/ownership da sinalização no servidor;
- cliente SSE de sinalização;
- offer/answer/ICE e fila de candidates;
- parser, limites, chunking e confirmação do protocolo de mídia;
- leitura do cache offline do usuário;
- lifecycle/revogação de object URLs;
- preflight que conclui a transferência antes de publicar `play-track`;
- E2E em dois contexts de navegador, mantendo o celular sem `<audio>` e verificando que a TV termina com uma fonte `blob:` para a faixa enviada.

O gate direcionado de TV executa `tv-remote-control.spec.ts` e `tv-offline-cast.spec.ts` em Chromium desktop.

O gate `tv-offline-lan.spec.ts` acrescenta cold start do PWA com `/api/*` indisponível, fixture LAN autenticada, receiver embarcado real, duas faixas e DataChannel real em Chromium.

## Validação física pendente

Antes de declarar suporte comprovado no BTV 11, validar no aparelho real:

- criação de `RTCPeerConnection` e DataChannel no GeckoView embarcado;
- pareamento e estabilidade do canal na rede Wi-Fi real;
- envio de uma faixa baixada real do celular e reprodução completa;
- play/pause, seek, next e crossfade depois de adotar a fonte P2P;
- regenerar a sessão e confirmar cleanup do peer/object URLs;
- comportamento ao desligar internet mantendo apenas a conectividade que ainda permite alcançar o servidor de sinalização;
- consumo de memória com faixas próximas do limite suportado.
