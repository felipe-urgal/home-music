# Contrato interno — bridge LAN v1

Status: **implementado como atividade 2 do PR #425**  
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

## Allowlist de operações

O contrato reconhece somente operações semânticas fechadas:

- `probe` — temporária enquanto o spike ainda existe;
- `challenge`;
- `join`;
- `signal-send`;
- `signal-poll`;
- `close`.

Não existem campos para URL, host, método ou headers arbitrários. Na atividade 2, somente `probe` é executada pelo `bridge.js`; as operações de produção respondem `not_implemented` até o relay da atividade 3 ser implementado.

Os endpoints LAN necessários já existem no `LanPairingServer`: `/challenge`, `/join`, `/signals` e `/close`. A próxima etapa deve apenas mapear as operações acima para esses endpoints same-origin, preservando as regras existentes do protocolo v2.

## Validação e limites

- mensagens precisam ter exatamente o shape esperado para seu `type`;
- `channelId` e `requestId` aceitam somente `[A-Za-z0-9._:-]`, entre 16 e 128 caracteres;
- `operation` precisa pertencer à allowlist;
- `payload` precisa ser um valor JSON puro, sem ciclos, funções, `undefined`, `BigInt` ou objetos com protótipo customizado;
- profundidade máxima validada: 32 níveis;
- tamanho máximo serializado por mensagem: **2 MiB**;
- requests/responses expiradas são descartadas;
- timeout padrão por request no PWA: **12 segundos**.

O limite de 2 MiB mantém margem para o tamanho de sinalização permitido atualmente pelo `LanPairingServer`, sem deixar o canal `postMessage` ilimitado.

## Lifecycle e cleanup

No probe atual:

1. o PWA cria `channelId` e abre o bridge;
2. o bridge envia `ready` para o origin exato;
3. o PWA cria `requestId`, envia `probe` e inicia timeout próprio da request;
4. o bridge valida source/origin/envelope e responde com o mesmo `channelId`, `requestId`, `operation` e deadline;
5. o PWA valida correlação e payload;
6. listeners, timeouts e polling de fechamento são removidos;
7. a janela bridge é fechada em best-effort.

Se o scanner fechar, uma nova tentativa começar ou o `AbortController` for abortado, a tentativa anterior é limpa. Mensagens tardias deixam de ter listener ativo e, enquanto a tentativa existir, também são rejeitadas por `channelId`, `requestId` ou `expiresAt`.

## Implementação e testes

- PWA: `apps/web/src/tv-lan-bridge-protocol.ts`;
- testes de contrato: `apps/web/src/tv-lan-bridge-protocol.test.ts`;
- integração temporária do probe: `apps/web/src/TvLanQrScanner.tsx`;
- runtime local da BTV: `android-tv/app/src/main/assets/bridge.js`.

Os testes de contrato cobrem versão, IDs, allowlist, shape exato, limite de payload, expiração, source/origin e correlação de responses. Testes de lifecycle completo do popup e o relay real permanecem nas atividades posteriores do plano de produção.
