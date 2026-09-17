# Contrato interno — bridge LAN v1

Status: **contrato, relay, transporte e lifecycle automatizado implementados no PR #425**  
Escopo: comunicação interna `Home Music HTTPS (PWA) ↔ BTV HTTP /bridge`

Este contrato existe somente para o adaptador de transporte usado no iOS. Ele **não substitui nem altera** o protocolo LAN `home-music-lan-remote-v2`, o pareamento, a derivação de `proof`/HMAC ou o transporte WebRTC/DataChannel.

## Abertura do canal

O PWA abre a página local por ação explícita do usuário:

```text
http://<ip-tv>:<porta>/bridge?origin=<origin-pwa>&channelId=<id-aleatorio>
```

Regras:

- `origin` precisa ser um origin HTTP/HTTPS completo e é usado como `targetOrigin` exato;
- `channelId` é aleatório por abertura e tem de possuir entre 16 e 128 caracteres seguros;
- o bridge rejeita configuração inválida e nunca usa `'*'` como `targetOrigin`;
- no PWA, mensagens só são aceitas quando `event.source` é exatamente a janela retornada por `window.open()` e `event.origin` é exatamente `http://<ip-tv>:<porta>`;
- no bridge, mensagens só são aceitas quando `event.source === window.opener` e `event.origin` é exatamente o `origin` recebido na abertura.

## Envelope

Versão atual:

```text
version = 1
```

### Ready

Enviado pelo bridge depois de validar `origin`, `channelId` e `window.opener`:

```json
{
  "version": 1,
  "type": "ready",
  "channelId": "<channel-id>"
}
```

### Request

```json
{
  "version": 1,
  "type": "request",
  "channelId": "<channel-id>",
  "requestId": "<request-id>",
  "operation": "challenge",
  "expiresAt": 0,
  "payload": {}
}
```

Cada operação recebe um `requestId` novo. `expiresAt` é epoch em milissegundos e impede que requests atrasadas de uma tentativa antiga sejam executadas.

### Response

```json
{
  "version": 1,
  "type": "response",
  "channelId": "<channel-id>",
  "requestId": "<request-id>",
  "operation": "challenge",
  "expiresAt": 0,
  "ok": true,
  "payload": {},
  "error": null
}
```

Em erro, `ok` é `false`, `payload` pode ser `null` e `error` contém um código curto e estruturado. O PWA só aceita a resposta quando `channelId`, `requestId` e `operation` correspondem à request pendente.

## Operações permitidas

O bridge reconhece somente operações semânticas fechadas. Não existe campo de URL, host, método ou headers arbitrários.

### `challenge`

Payload:

```json
{
  "sessionId": "<session-id>",
  "clientNonce": "<client-nonce>"
}
```

Target reconstruído pelo bridge:

```text
GET /challenge?session=<sessionId>&clientNonce=<clientNonce>
```

### `join`

O `proof` é calculado no PWA e somente retransmitido de forma transitória pelo bridge.

Payload:

```json
{
  "sessionId": "<session-id>",
  "clientNonce": "<client-nonce>",
  "tvNonce": "<tv-nonce>",
  "expiresAt": 0,
  "proof": "<proof-hmac>"
}
```

Target reconstruído pelo bridge:

```text
POST /join
```

### `signal-send`

A autorização HMAC continua sendo calculada no PWA. O corpo é enviado como string JSON para preservar exatamente os bytes usados na assinatura.

Payload:

```json
{
  "authorization": "HomeMusic <assinatura>",
  "body": "{\"messageId\":\"...\",\"from\":\"remote\",\"signal\":{...}}"
}
```

Target fixo:

```text
POST /signals?role=remote
```

### `signal-poll`

Payload:

```json
{
  "authorization": "HomeMusic <assinatura>",
  "cursor": 0
}
```

Target reconstruído:

```text
GET /signals?role=remote&cursor=<cursor>
```

### `complete`

Operação local de handoff usada quando o `RTCDataChannel` já abriu. Ela **não** chama `/close` e não encerra a sessão P2P.

Payload:

```json
null
```

Resposta de sucesso:

```json
{
  "status": 204,
  "body": null
}
```

Depois da resposta, o bridge informa que a conexão P2P está pronta e tenta fechar sua janela em best-effort. Se o navegador impedir `window.close()`, a instrução para voltar ao Home Music permanece visível.

### `close`

Usada para encerrar a sessão LAN antes do handoff P2P quando necessário.

Payload:

```json
{
  "authorization": "HomeMusic <assinatura>"
}
```

Target fixo:

```text
POST /close?role=remote
```

Depois de uma resposta de sucesso, o bridge tenta fechar sua janela em best-effort. Se o navegador impedir `window.close()`, a página mostra instrução para voltar ao Home Music.

## Respostas do relay

Para requests HTTP concluídas, o payload de resposta é:

```json
{
  "status": 200,
  "body": {}
}
```

Erros normalizados atualmente:

- `invalid_payload` — payload não corresponde ao shape da operação;
- `duplicate_request` — o mesmo `requestId` já está em execução;
- `timeout` — request same-origin ultrapassou o deadline;
- `network_error` — falha de transporte local;
- `http_error` — o `LanPairingServer` respondeu HTTP não-2xx; `payload.status` e `payload.body` são preservados quando válidos;
- `invalid_response` — response HTTP não contém JSON válido;
- `response_too_large` — resposta excedeu o limite do contrato.

O bridge não traduz códigos de pareamento em semântica nova. O PWA continua responsável por transformar status como `401`, `403`, `404`, `410` e `429` nos mesmos erros de UX já usados pelo transporte direto.

## Segurança e limites

- mensagens precisam ter exatamente o shape esperado para seu `type`;
- `channelId` e `requestId` aceitam somente `[A-Za-z0-9._:-]`, entre 16 e 128 caracteres;
- tokens do protocolo LAN aceitam o mesmo limite de 16 a 192 caracteres usado pelo `LanPairingSession`;
- `operation` precisa pertencer à allowlist;
- `payload` precisa ser um valor JSON puro, sem ciclos, funções, `undefined`, `BigInt` ou objetos com protótipo customizado;
- profundidade máxima validada: 32 níveis;
- tamanho máximo serializado por mensagem `postMessage`: **2 MiB**;
- corpo de `signal-send`: máximo **320 KiB**, alinhado a `LanPairingSession.MAX_REQUEST_BYTES`;
- requests same-origin usam `cache: no-store`, `credentials: omit` e `AbortController`;
- timeout interno do relay: no máximo **10 segundos**, nunca além de `expiresAt` da request;
- responses expiradas não são reenviadas ao PWA;
- o bridge não recebe o `secret` do QR nem deriva chaves;
- `proof` e `Authorization` atravessam o bridge apenas de forma transitória e não são exibidos, persistidos ou logados;
- `signal-send` preserva o corpo assinado sem reserialização;
- targets HTTP são reconstruídos pelo bridge e sempre apontam para o próprio `LanPairingServer` same-origin;
- `/receiver/*` continua protegido pela regra loopback-only do servidor e não é exposto pelo bridge.

## Cliente PWA e abstração de transporte

A atividade 4 introduziu `TvLanTransport`/`TvLanTransportFactory` em `apps/web/src/tv-lan-transport.ts`. O `createTvLanRemoteSignaling` usa essa interface para `challenge`, `join`, `signal-send`, `signal-poll`, `complete` e `close`.

O transporte direto continua sendo o default e preserva o comportamento existente. O bridge é implementado em `apps/web/src/tv-lan-bridge-client.ts` e pode ser fornecido como `transportFactory`, sem duplicar:

- parsing/validação do QR;
- derivação do `proof` de join;
- derivação da chave de request;
- HMAC de `signals`/`close`;
- validação de challenge/join;
- validação dos envelopes de sinalização;
- cursor e loop de polling.

Isso mantém o `secret` e toda a criptografia no PWA. O bridge recebe apenas os campos semânticos necessários, o `proof` já calculado e a `Authorization` já assinada.

## Concorrência e lifecycle

O bridge permite requests diferentes em paralelo, necessário para não bloquear envio de ICE enquanto o polling de sinalização está em andamento. O mesmo `requestId` não pode ser executado duas vezes simultaneamente.

No fluxo atual:

1. o PWA cria `channelId` e abre o bridge;
2. o bridge envia `ready` para o origin exato;
3. cada request recebe `requestId` e `expiresAt` próprios;
4. o bridge valida source/origin/envelope e o payload da operação;
5. o bridge executa somente o endpoint same-origin correspondente;
6. a response volta com o mesmo `channelId`, `requestId`, `operation` e deadline;
7. responses expiradas ou de outra tentativa não resolvem requests pendentes;
8. quando o DataChannel abre, PWA e receiver finalizam o signaling local;
9. no transporte bridge, `complete` encerra listeners/timers/popup do adaptador sem chamar `/close` e sem derrubar o P2P;
10. antes do handoff, `close` continua disponível para encerrar a sessão LAN quando necessário.

O cliente do popup trata `popup blocked`, timeout de `ready`, timeout por request, `AbortSignal`, correlação por `requestId` e fechamento best-effort.

A seleção do transporte está integrada ao fluxo de UI: iPhone/iPad/iPadOS usam bridge por ação explícita do usuário; Android/desktop preservam o transporte direto. O lifecycle automatizado está coberto, mas background/foreground e fechamento bloqueado ainda dependem do QA físico no iPhone.

## Implementação e testes

- contrato PWA: `apps/web/src/tv-lan-bridge-protocol.ts`;
- testes de contrato: `apps/web/src/tv-lan-bridge-protocol.test.ts`;
- abstração de transporte: `apps/web/src/tv-lan-transport.ts`;
- cliente popup/bridge: `apps/web/src/tv-lan-bridge-client.ts`;
- testes do cliente popup: `apps/web/src/tv-lan-bridge-client.test.ts`;
- integração do transporte no cliente LAN: `apps/web/src/tv-lan-remote-client.ts`;
- teste de proof/HMAC e lifecycle via transporte bridge: `apps/web/src/tv-lan-remote-bridge-transport.test.ts`;
- seleção do transporte: `apps/web/src/tv-lan-transport-selection.ts`;
- integração do QR/gesto de conexão: `apps/web/src/TvLanQrScanner.tsx`;
- runtime local da BTV: `android-tv/app/src/main/assets/bridge.js`;
- E2E do caminho bridge: `e2e/tests/tv-offline-lan-bridge.spec.ts`;
- endpoints e regras LAN existentes: `android-tv/app/src/main/java/com/homemusic/tv/LanPairingServer.java` e `LanPairingSession.java`.

A operação temporária `probe` foi removida do contrato e do runtime após a integração do fluxo real. O caminho automatizado de produção está implementado; a declaração final de suporte continua pendente do QA físico completo no iPhone/BTV e da matriz real de compatibilidade.
