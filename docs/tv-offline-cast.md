# Transmissão de downloads do celular para a TV

## Objetivo

O Home Music pode enviar uma faixa já baixada no navegador do celular diretamente para a experiência TV. Existem dois modos de sinalização:

- **online**: o servidor Home Music continua responsável por autenticação, ownership da sessão remota e sinalização WebRTC, mas não transporta bytes de áudio;
- **LAN totalmente offline**: bootstrap e sinalização acontecem diretamente com o serviço efêmero da TV, sem backend/WAN durante a sessão.

Nos dois casos, a TV continua dona do player canônico e a mídia P2P usa o mesmo WebRTC/DataChannel.

## Fluxo online

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
6. somente após a confirmação, o celular publica o comando `play-track`;
7. o `useCrossfadeAudioPlayer` encontra a fonte transitória e a adota no mesmo player/decks já usados pela TV.

Se a faixa não estiver baixada ou o canal P2P ainda não estiver pronto, o modo online preserva o comportamento normal do servidor quando aplicável.

## Armazenamento offline do celular

Nenhuma cópia adicional é criada. O envio reutiliza:

```text
home-music-offline-audio-v2-<userId>
```

A entrada física continua sendo a request canônica:

```text
/api/tracks/<trackId>/stream
```

O manifesto `home-music:offline-tracks:v2:<userId>` permanece a projeção lógica do download. A leitura para transmissão exige a identidade offline atual, resposta `200`, MIME `audio/*`, conteúdo não vazio e tamanho dentro do limite.

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
- encerramento/regeneração da sessão e unmount revogam URLs transitórios;
- reprodução manual e preparação do segundo deck de crossfade consultam primeiro a fonte P2P;
- não existe segundo `<audio>`, segundo estado de fila ou player paralelo.

No receiver offline, a quantidade de fontes transitórias é limitada e a fila precisa permanecer compatível com o conjunto ainda reproduzível.

## Segurança e isolamento

No modo online:

- endpoints de sinalização usam autenticação normal da sessão;
- ownership da sessão remota é aplicado pelo backend;
- mutações preservam `X-Home-Music-Request: 1`;
- SDP e ICE possuem validação e limites de tamanho.

Nos dois modos:

- bytes de áudio nunca entram no backend nem no serviço HTTP LAN;
- sinais próprios são ignorados pelo peer;
- cache offline continua namespaced pela identidade local do dispositivo;
- a superfície de controle do celular continua sem `<audio>` local;
- object URLs e peer são limpos ao encerrar a sessão.

## Offline total pela LAN

O modo LAN reutiliza o mesmo protocolo binário e player, mas substitui a sinalização online por uma sessão efêmera `home-music-lan-remote-v2`.

```text
PWA / Cache Storage
       |
       | bootstrap + signaling LAN
       v
serviço efêmero no APK
       |
       | offer/answer/ICE
       v
receiver offline por loopback
       ^
       |
       +===== WebRTC/DataChannel ===== celular
             mídia + comandos + estado
```

O PWA permanece na origin Home Music para preservar Cache Storage. Depois de abrir o DataChannel, mídia, comandos e snapshots trafegam diretamente entre celular e TV, sem REST/SSE do Home Music.

Frames textuais usam `home-music-data-v1`; chunks de áudio continuam binários. `sendTrackAndPlay` aguarda `media-ready` antes de publicar `play-track`, e a TV permanece autoridade do playback. Faixa ausente no cache falha explicitamente, sem fallback online no modo LAN.

### Android/desktop

Plataformas capazes de alcançar o HTTP privado da TV usam o transporte LAN direto com `fetch`/polling autenticado.

### iPhone/iPad

No iOS, o transporte direto HTTPS → HTTP privado não é assumido. O fluxo usa uma página local `/bridge` aberta como navegação top-level e troca mensagens com o PWA por `postMessage`.

O bridge:

- adapta somente `challenge`, `join`, signaling, `complete` e `close`;
- não recebe o `secret` do QR;
- não deriva HMAC;
- não transporta mídia;
- não é um proxy HTTP genérico;
- tenta encerrar a própria janela após o handoff P2P e mantém instrução manual quando o browser bloqueia `window.close()`.

Depois do DataChannel aberto, a mídia e os comandos continuam P2P normalmente.

## Receiver automático após pareamento

Desde o hardening do PR #430, um `join` LAN autenticado notifica o APK para abrir o receiver offline automaticamente. A ação ocorre uma vez para o join válido; replay não dispara nova abertura.

**Abrir receiver offline** permanece disponível como fallback manual, mas não faz parte do happy path esperado após ler o QR e concluir o join.

## Desconexão transitória e falha real

`RTCPeerConnection.connectionState = disconnected` não é tratado como erro terminal por timeout fixo. Em mobile, background/lock ou oscilação temporária podem produzir esse estado sem significar que a sessão morreu.

Comportamento atual:

- `disconnected` → estado de conexão em recuperação, sem fechar o peer;
- retorno a `connected` → sessão volta a `open` se o DataChannel continua aberto;
- `failed` → erro terminal e cleanup;
- `closed` → encerramento terminal;
- fechamento/erro real do DataChannel → encerramento terminal.

Não há ICE restart ou reconexão automática complexa nesta fase. Se a conexão realmente falhar, o caminho seguro continua sendo novo pareamento/QR.

## Testes automatizados

A cobertura inclui:

- validação/ownership da sinalização online;
- offer/answer/ICE e fila de candidates;
- parser, limites, chunking e confirmação do protocolo de mídia;
- leitura do cache offline;
- lifecycle/revogação de object URLs;
- preflight `transferência -> media-ready -> play-track`;
- DataChannel real entre dois contexts de navegador;
- sessão LAN autenticada sem `/api/*` durante playback;
- receiver dedicado do APK em fixture;
- bridge iOS com `challenge → join → signaling → DataChannel`;
- fechamento inesperado do DataChannel;
- `disconnected` transitório e prolongado recuperável;
- `disconnected → failed` permanecendo terminal;
- `join` autenticado iniciando o receiver uma única vez.

Os gates direcionados de TV incluem `tv-remote-control.spec.ts`, `tv-offline-cast.spec.ts`, `tv-offline-lan.spec.ts` e o E2E do bridge iOS.

## Validação física

O QA físico já confirmou no iPhone + BTV que o caminho principal consegue chegar a:

```text
iPhone -> bridge LAN -> WebRTC/DataChannel -> envio de música offline -> reprodução na BTV
```

As rodadas físicas também revelaram problemas de lifecycle que motivaram os PRs #427 e #430. Portanto a implementação está na `main`, mas a matriz final de compatibilidade e estabilidade ainda deve permanecer explicitamente pendente nas issues #417/#422.

No head/APK usado para homologação final, validar e registrar:

- cold start com WAN e backend desligados;
- pareamento sem clicar em **Abrir receiver offline**;
- duas faixas reais e controles essenciais;
- background/lock por período prolongado e recuperação dos controles;
- diferença entre `disconnected` temporário e perda real de rede;
- QR expirado/regenerado;
- popup/fechamento do bridge iOS;
- AP/client isolation;
- cleanup de peer, porta e blobs;
- retorno ao modo online depois de religar backend/WAN;
- versões de iOS/browser, BTV/Android e GeckoView.

Não declarar suporte físico completo além da evidência registrada.
