# Protocolo LAN offline da TV

## Objetivo

`home-music-lan-remote-v2` permite parear o Home Music já carregado no celular com o receiver do Android TV pela mesma rede local, sem depender do backend Home Music durante a sessão LAN.

Este documento é o contrato vivo do protocolo. O código continua sendo a autoridade executável.

Fontes principais:

- `packages/shared/src/tv-lan-remote.ts`;
- `apps/web/src/tv-lan-remote-client.ts`;
- `apps/web/src/tv-lan-transport-selection.ts`;
- `apps/web/src/tv-lan-bridge-protocol.ts`;
- `android-tv/app/src/main/java/com/homemusic/tv/LanPairingSession.java`;
- `android-tv/app/src/main/java/com/homemusic/tv/LanPairingServer.java`.

## Fronteiras

- O serviço HTTP efêmero roda no Android TV e atende bootstrap, challenge/join, receiver local e sinalização WebRTC.
- O receiver embarcado acessa o serviço por loopback.
- O celular usa o transporte LAN apenas para estabelecer a sessão e trocar sinalização.
- Depois que o DataChannel abre, mídia e comandos não usam o HTTP LAN como proxy.
- Nenhuma credencial da conta Home Music faz parte do QR ou do protocolo LAN.
- O papel `remote` exige HMAC por request depois do join.
- O papel `tv` usa token próprio do receiver embarcado.
- Em iPhone/iPad, a aplicação seleciona o bridge LAN; nas demais plataformas usa o transporte direto.

## QR

Formato lógico:

```text
home-music://tv-lan?version=home-music-lan-remote-v2&host=<ipv4>&port=<porta>&session=<id>&secret=<segredo>&expires=<epoch-ms>
```

Regras:

- `version`: exatamente `home-music-lan-remote-v2`;
- `host`: somente IPv4 privado `10/8`, `172.16/12` ou `192.168/16`;
- `port`: `1024..65535`;
- `session`: token efêmero URL-safe;
- `secret`: segredo efêmero URL-safe, separado das credenciais Home Music;
- `expires`: expiração do pareamento, limitada a 2 minutos.

Gerar um novo pareamento fecha a sessão anterior antes de criar outro QR.

## Handshake

### Challenge

O celular gera `clientNonce` e chama:

```text
GET /challenge?session=<sessionId>&clientNonce=<clientNonce>
```

A TV responde com:

```json
{
  "sessionId": "...",
  "clientNonce": "...",
  "tvNonce": "...",
  "expiresAt": 1800000000000
}
```

O challenge vence no máximo em 60 segundos e nunca ultrapassa a expiração do pareamento.

### Prova de posse

A mensagem usada no HMAC é exatamente:

```text
home-music-lan-remote-v2
<sessionId>
<clientNonce>
<tvNonce>
<challengeExpiresAt>
```

A prova é:

```text
base64url(HMAC-SHA256(secret, mensagem))
```

O join usa:

```text
POST /join
```

com `sessionId`, `clientNonce`, `tvNonce`, `expiresAt` e `proof`.

Após uma prova válida:

- a TV cria `sessionToken`;
- a sessão estabelecida expira em até 30 minutos;
- o segredo original do QR é apagado da sessão;
- challenges pendentes são descartados;
- apenas um remoto pode completar o join daquela sessão;
- o receiver offline pode ser aberto pela notificação do join autenticado.

## Autenticação das requisições remotas

TV e celular derivam uma chave de request a partir do segredo do QR, challenge e sessão estabelecida. Essa chave não trafega pela rede.

Requisições `remote` autenticadas usam:

```text
Authorization: HomeMusic <sessionToken>.<timestamp>.<requestNonce>.<signature>
```

A assinatura vincula:

- versão;
- `sessionId`;
- `sessionToken`;
- método HTTP em maiúsculas;
- path e query exatos;
- SHA-256 do body bruto;
- timestamp;
- nonce da requisição.

A TV rejeita:

- token de outra sessão;
- assinatura inválida;
- alteração de método, target ou body;
- timestamp fora da janela de 60 segundos;
- nonce já aceito;
- sessão expirada ou fechada.

O cache de nonces aceitos é limitado a 256 entradas.

## Endpoints

Endpoints públicos do serviço LAN:

| Método | Endpoint | Uso |
| --- | --- | --- |
| `GET` | `/health` | versão e estado básico |
| `GET` | `/challenge` | challenge do pareamento |
| `POST` | `/join` | prova HMAC e criação da sessão |
| `GET` | `/signals?role=...` | polling de sinalização |
| `POST` | `/signals?role=...` | publicação de sinalização |
| `POST` | `/close?role=...` | encerramento da sessão |
| `GET` | `/bridge` | bridge LAN para iOS |
| `GET` | `/bridge.js` | código do bridge |

Endpoints do receiver são restritos a loopback:

- `/receiver`;
- `/receiver/*`;
- `/receiver/bootstrap`.

## Sinalização WebRTC

Envelope:

```json
{
  "messageId": "token-url-safe-unico",
  "from": "remote",
  "signal": {
    "from": "remote",
    "type": "description",
    "description": {
      "type": "offer",
      "sdp": "..."
    }
  }
}
```

Regras principais:

- `from` do envelope deve coincidir com `signal.from`;
- `messageId` repetido é rejeitado;
- offer/answer usam os limites do contrato compartilhado;
- candidate ICE é limitado;
- a mailbox mantém no máximo 128 sinais;
- requests HTTP têm body máximo de 320 KiB;
- o serviço aplica rate limit por IP.

Limites atuais do servidor Android:

- janela de rate limit: 10 s;
- até 120 requests por IP na janela;
- até 128 IPs rastreados;
- até 64 headers;
- linha de header até 8 KiB;
- socket timeout de 10 s.

## Bridge LAN no iOS

A seleção de transporte usa bridge em iPhone/iPad e transporte direto nas demais plataformas.

O bridge aceita somente operações conhecidas:

- `challenge`;
- `join`;
- `signal-send`;
- `signal-poll`;
- `complete`;
- `close`.

O protocolo do bridge:

- usa versão própria `1`;
- valida `origin`, `source`, `channelId`, `requestId` e operação;
- limita cada mensagem serializada a 2 MiB;
- usa timeout padrão de 12 s;
- não oferece proxy arbitrário de URL, método ou header;
- não substitui o transporte de mídia por DataChannel.

## CORS e rede local

O servidor responde somente aos métodos e headers necessários e inclui suporte ao preflight de acesso à rede privada.

A origin é validada antes de atender requests não locais. O receiver embarcado tem exceções restritas ao próprio loopback.

O transporte direto transforma falha de permissão em erro distinto de TV inalcançável quando o browser expõe o estado de Local Network Access.

## Threat model

### Protegido

- conhecer IP e porta da TV não é suficiente para assumir o papel remoto;
- o QR não contém usuário, senha, cookie ou token de conta;
- challenge e segredo expiram;
- join é de uso único;
- `sessionToken` sozinho não autoriza requests `remote`;
- método, target, body, timestamp e nonce fazem parte da assinatura;
- replay de request aceito é bloqueado;
- replay de `messageId` é bloqueado enquanto estiver na janela bounded;
- regenerar ou fechar a sessão elimina material efêmero;
- payloads, filas, nonces e conexões têm limites explícitos.

### Não protegido

O bootstrap e a sinalização usam HTTP na LAN, sem TLS próprio. Um atacante capaz de observar ou interferir nessa rede ainda pode:

- observar metadados HTTP e sinalização WebRTC;
- bloquear ou atrasar tráfego;
- tentar corrida com material do QR ainda válido;
- causar indisponibilidade dentro dos limites da rede.

Depois que o WebRTC está estabelecido, mídia e comandos seguem pelo DataChannel.

## Limites canônicos

| Limite | Valor |
| --- | ---: |
| Pairing TTL | 120000 ms |
| Sessão estabelecida | 1800000 ms |
| Clock skew de request | 60000 ms |
| Nonces de request lembrados | 256 |
| Poll recomendado | 25000 ms |
| Sinais pendentes | 128 |
| Body HTTP | 327680 bytes |
| SDP | 256 KiB |
| ICE candidate | 8 KiB |

## Compatibilidade e homologação

O código possui dois caminhos:

- transporte direto para plataformas não iOS;
- bridge LAN para iPhone/iPad.

A matriz final de suporte deve ser baseada em evidência física, não apenas em CI. As issues #417 e #422 permanecem abertas para registrar:

- browser e versão;
- Android/BTV e GeckoView;
- acesso Local Network Access real;
- fluxo com WAN e backend desligados;
- AP/client isolation e falhas de rede;
- expiração/regeneração;
- lifecycle/background;
- reprodução e controles por DataChannel.

### Navegador comum e celular bloqueado

A instalação como PWA não é requisito do protocolo LAN. O pareamento pode ser iniciado em uma aba normal do navegador, desde que o navegador tenha acesso aos downloads offline, WebRTC e à rede local.

Depois que uma faixa termina de ser enviada, o áudio fica em memória na TV e a reprodução não depende da execução contínua do JavaScript no celular. Se o sistema suspender a aba/PWA ao bloquear a tela, a faixa já recebida continua tocando na TV.

Ao retomar o navegador, um DataChannel encerrado é recriado automaticamente quando o `RTCPeerConnection` ainda está válido. Isso evita exigir um novo QR em suspensões transitórias. Se o sistema operacional ou a rede levarem o peer ao estado terminal `failed`, um novo pareamento continua sendo necessário.

Comandos novos e o envio de outra faixa não podem ser garantidos enquanto o navegador estiver totalmente suspenso pelo sistema operacional.

Enquanto essa homologação não terminar, não ampliar a declaração de suporte para hardware ou browsers não verificados.
