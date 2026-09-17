# Home Music TV — protocolo LAN offline v2

## Objetivo

`home-music-lan-remote-v2` permite parear o PWA Home Music já instalado no celular com o BTV 11 pela mesma LAN quando **WAN e servidor Home Music estão indisponíveis**.

O protocolo local não substitui a conta Home Music. Ele autoriza somente uma sessão efêmera entre o celular que possui o segredo exibido pela TV e o receiver daquele aparelho.

## Fronteiras

- O PWA permanece na origin Home Music para continuar acessando Cache Storage e manifestos offline.
- O APK da TV hospeda HTTP local somente para bootstrap, challenge/join e sinalização WebRTC.
- O receiver offline roda no GeckoView e fala com o serviço nativo por loopback.
- Depois que o RTCDataChannel abre, mídia, comandos e estado usam o peer; o HTTP local não é proxy de áudio.
- Nenhum cookie, username, senha, token de sessão ou user id Home Music é requisito do protocolo LAN.
- O bearer simples do receiver é aceito somente no papel `tv`, usado pelo receiver embarcado via loopback. Requisições `remote` vindas do celular exigem assinatura HMAC por request.
- No iPhone/iPad, `/bridge` pode adaptar somente as operações de signaling por navegação top-level + `postMessage`; ele não recebe o segredo do QR, não deriva HMAC e não transporta mídia.

## Compatibilidade observada e pendente

O caminho direto do MVP é Android/Chrome com Local Network Access disponível para uma aplicação HTTPS alcançar `http://<ipv4-privado-da-tv>:<porta>` após ação explícita do usuário. O hardware alvo é BTV 11 com GeckoView 126 no receiver.

No iPhone/iOS, o transporte direto HTTPS → HTTP privado não é assumido. O caminho implementado usa o bridge local top-level. QA físico em 17/09/2026 confirmou o caminho principal **iPhone → bridge LAN → WebRTC/DataChannel → envio de música offline → reprodução na BTV**. A homologação final de estabilidade, background/lock, perda de rede e matriz de versões continua pendente nas issues #417/#422.

| Ambiente | Estado atual |
| --- | --- |
| Chrome Android com Local Network Access | alvo do transporte direto; validação física final ainda deve registrar versões e negativos |
| PWA instalado | alvo principal |
| aba normal na mesma origin | não assumir paridade com PWA sem teste específico |
| GeckoView 126 no BTV 11 | receiver alvo; caminho principal já exercitado fisicamente com iPhone, matriz final pendente |
| iPhone/iPad | bridge LAN implementado; caminho principal validado fisicamente, estabilidade/lifecycle final pendentes |
| redes com AP/client isolation | não suportadas; devem falhar de forma distinguível |

WebSocket local não é requisito de v2. Bootstrap/sinalização usam HTTP `fetch` + polling no caminho direto e o mesmo contrato lógico por bridge no iOS.

## QR

Texto canônico:

```text
home-music://tv-lan?version=home-music-lan-remote-v2&host=192.168.1.40&port=43123&session=<id>&secret=<segredo>&expires=<epoch-ms>
```

Campos:

- `version`: exatamente `home-music-lan-remote-v2`;
- `host`: IPv4 privado RFC1918 (`10/8`, `172.16/12`, `192.168/16`);
- `port`: `1024..65535`;
- `session`: token URL-safe aleatório de alta entropia;
- `secret`: segredo URL-safe aleatório de alta entropia, diferente de qualquer credencial Home Music;
- `expires`: epoch em milissegundos, no máximo 2 minutos após criação.

O scanner do PWA **lê o texto; não navega para essa URI**.

## Sessão e autenticação

### 1. Criar pareamento na TV

Ao abrir “Modo offline local / Conectar celular”, o APK:

1. resolve um IPv4 LAN válido;
2. abre listener efêmero;
3. gera `sessionId`, `secret` e expiração;
4. mostra QR;
5. invalida imediatamente qualquer sessão de pareamento anterior.

### 2. Challenge

O celular gera `clientNonce` aleatório e solicita challenge para `sessionId`. A TV responde:

```json
{
  "sessionId": "...",
  "clientNonce": "...",
  "tvNonce": "...",
  "expiresAt": 1800000000000
}
```

A TV associa esse challenge à sessão e aceita cada `clientNonce/tvNonce` uma única vez.

### 3. Prova de posse do QR

A mensagem autenticada é UTF-8, exatamente:

```text
home-music-lan-remote-v2
<sessionId>
<clientNonce>
<tvNonce>
<challengeExpiresAt>
```

`proof = base64url(HMAC-SHA256(secret, mensagem))`.

O servidor local compara a prova em tempo constante. Challenge expirado, nonces reutilizados, segredo consumido ou sessão regenerada são rejeitados.

### 4. Join e chave de autenticação da sessão

Após prova válida, a TV retorna `sessionToken` e `sessionExpiresAt`. Antes de descartar o segredo do QR, TV e celular derivam independentemente a mesma chave de request:

```text
requestKey = HMAC-SHA256(secret, UTF8(
  "home-music-lan-remote-v2\nrequest-key\n" +
  sessionId + "\n" +
  clientNonce + "\n" +
  tvNonce + "\n" +
  challengeExpiresAt + "\n" +
  sessionToken + "\n" +
  sessionExpiresAt
))
```

A `requestKey` nunca trafega pela rede. O `sessionToken` passa a identificar/vincular a sessão, mas **não é suficiente sozinho para autorizar o papel `remote`**.

No MVP existe no máximo **um remoto ativo por sessão**.

Depois de um `join` autenticado aceito, o servidor LAN notifica a Activity Android para abrir o receiver offline automaticamente. A notificação é one-shot para aquele join válido; replay do mesmo join permanece rejeitado e não deve reabrir o receiver.

### 5. Autenticação de cada request remoto

Toda requisição do celular para `/signals` ou `/close` usa:

```text
Authorization: HomeMusic <sessionToken>.<timestamp>.<requestNonce>.<signature>
```

O corpo é hasheado exatamente como foi enviado:

```text
bodyHash = base64url(SHA256(rawHttpBodyBytes))
```

A mensagem assinada é:

```text
home-music-lan-remote-v2
request
<sessionId>
<sessionToken>
<METHOD_EM_MAIÚSCULAS>
<path+query exatos>
<bodyHash>
<timestamp>
<requestNonce>
```

`signature = base64url(HMAC-SHA256(requestKey, mensagem))`.

A TV verifica antes de aceitar o request:

- token associado à sessão remota ativa;
- assinatura em tempo constante;
- método, path/query e hash do body exatamente vinculados à assinatura;
- timestamp dentro da janela máxima de 60 s;
- `requestNonce` URL-safe ainda não aceito naquela sessão.

Nonces aceitos são guardados em cache limitado a 256 itens. Capturar somente o `sessionToken` não permite criar novos requests válidos e um request já aceito não pode ser repetido com sucesso.

O receiver embarcado usa `Bearer <receiverToken>` apenas no papel `tv` e somente pelo endpoint loopback `127.0.0.1`.

## Bridge LAN no iOS

O bridge é um adaptador restrito para plataformas em que o PWA HTTPS não consegue executar diretamente o `fetch()` para o HTTP privado da TV.

Fluxo:

1. o PWA abre `http://<host>:<port>/bridge` por ação explícita do usuário;
2. PWA e bridge vinculam a sessão com `window.opener`, `postMessage`, `origin`, `source` e `channelId`;
3. o PWA continua calculando proof/HMAC e mantendo o `secret`;
4. o bridge executa apenas operações allowlisted (`challenge`, `join`, `signal-send`, `signal-poll`, `complete`, `close`);
5. ao abrir o DataChannel, o PWA envia `complete`; signaling termina e a janela tenta fechar;
6. se `window.close()` for bloqueado, a página mantém instrução para retornar/fechar manualmente.

O bridge não aceita URL, host, método ou headers arbitrários do PWA e não é caminho de mídia.

## Sinalização WebRTC

Cada mensagem usa envelope:

```json
{
  "messageId": "token-url-safe-unico",
  "from": "remote",
  "signal": {
    "from": "remote",
    "type": "description",
    "description": { "type": "offer", "sdp": "..." }
  }
}
```

Regras:

- `from` do envelope deve ser igual a `signal.from`;
- validação de SDP/ICE reutiliza os limites do controle remoto online;
- `messageId` repetido é replay e deve ser ignorado/rejeitado;
- mailbox tem no máximo 128 sinais pendentes;
- polling recomendado: até 25 s;
- body HTTP máximo: 320 KiB;
- o serviço aplica rate limit por IP e encerra abuso sem afetar o receiver local.

Sem STUN/TURN público no modo LAN v2. O peer deve usar candidates host/local e falhar explicitamente quando a rede bloquear comunicação entre clientes.

## DataChannel comum

Depois da sinalização, online e LAN usam o mesmo canal ordenado `home-music-media-v1`. Há dois framings não ambíguos:

- bytes binários pertencem à transferência de mídia anunciada por `media-start`;
- strings JSON são controles de mídia existentes ou envelopes `home-music-data-v1` para comando, snapshot, erro e disconnect.

Cada envelope possui `id` efêmero limitado e é deduplicado com memória bounded. Versão, shape ou limites inválidos são ignorados/rejeitados. O sender conclui os chunks, aguarda `media-ready` e somente então envia `play-track`. A TV valida a faixa transitória disponível e continua sendo autoridade do player.

O receiver mantém no máximo três fontes de mídia transitórias e mantém a fila/metadados sincronizados com esse conjunto reproduzível; URLs de blob expulsas são revogadas e não permanecem como entradas de fila inutilizáveis.

### Estados de conexão

`RTCPeerConnection.connectionState = disconnected` não encerra a sessão por timeout fixo. Esse estado pode ser transitório em background/lock ou durante oscilação breve da rede.

- `disconnected`: peer permanece vivo e a UI pode indicar reconexão;
- retorno a `connected`: sessão pode voltar a `open` se o DataChannel continua aberto;
- `failed`: terminal, com erro/cleanup;
- `closed`: terminal;
- fechamento/erro real do DataChannel: terminal.

Não há ICE restart complexo nesta versão. Se a conexão realmente falhar, novo QR/pareamento é exigido.

## Lifecycle

- TTL do QR/challenge: 2 min;
- TTL máximo da sessão estabelecida sem renovação válida: 30 min;
- regenerar QR invalida secret, challenge, token, request key, nonces e mailbox anteriores;
- fechar pareamento/receiver limpa material efêmero;
- mudança de IP invalida o QR antigo e exige novo pareamento;
- Activity/app encerrado fecha listener;
- reconnect só é permitido enquanto a mesma sessão continuar válida;
- `disconnected` transitório por si só não invalida a sessão nem fecha o peer;
- blobs de mídia continuam transitórios e são revogados no receiver.

## CORS e Local Network Access

O serviço LAN responde somente aos métodos/headers necessários. Para requests vindos do PWA no caminho direto, a origin permitida é validada conforme configuração/contrato do app; endpoints autenticados não usam política permissiva indiscriminada.

Preflight/headers exigidos pela implementação de Local Network Access do browser alvo devem ser cobertos pelo QA físico. Negação da permissão deve gerar estado separado de “TV não encontrada”.

No iOS, o bridge top-level existe justamente para não depender de um `fetch()` HTTPS → HTTP privado que a plataforma não oferece de forma utilizável no fluxo validado.

## Threat model

### Protegido

- dispositivo aleatório da LAN não controla a TV apenas conhecendo IP/porta;
- `sessionToken` capturado isoladamente não autoriza requests `remote`;
- alteração de método, query ou corpo invalida uma assinatura capturada;
- request assinado já aceito não pode ser repetido por causa do `requestNonce`;
- requests com timestamp fora da janela são rejeitados;
- QR antigo deixa de valer ao expirar/regenerar;
- credenciais Home Music não são expostas ao serviço LAN;
- payloads, mailbox, cache de nonces e mídia transitória têm limites explícitos;
- sessão fechada não deixa material de autenticação reaproveitável;
- bridge não recebe o segredo do QR nem oferece proxy arbitrário.

### Não protegido nesta fase

O HTTP de bootstrap/sinalização na LAN continua **sem confidencialidade**. Portanto um atacante com capacidade de observar ou interferir no caminho local ainda pode:

- ler metadados HTTP, SDP/ICE e outros dados de sinalização que trafegam antes do DataChannel;
- bloquear, atrasar ou derrubar tráfego (DoS);
- tentar retransmitir um request assinado capturado antes que a TV o receba. A assinatura impede alteração/forja e o nonce impede novo uso depois da primeira aceitação, mas não transforma HTTP local em TLS.

Além disso:

- atacante que fotografa/captura o QR válido antes do uso pode tentar parear durante a janela curta;
- modo offline não fornece acesso entre redes diferentes;
- não há identidade persistente do celular: a confiança inicial é o segredo efêmero apresentado fisicamente pela TV.

Depois que o WebRTC DataChannel está estabelecido, mídia e comandos deixam de usar o HTTP LAN de sinalização e seguem pelo transporte seguro do WebRTC.

## Limites v2

- pairing TTL: `120000 ms`;
- established session TTL: `1800000 ms`;
- request timestamp skew: `60000 ms`;
- request nonces lembrados: `256`;
- poll: `25000 ms`;
- pending signals: `128`;
- HTTP request body: `327680 bytes`;
- transient receiver media sources: `3`;
- SDP: `256 KiB`;
- ICE candidate: `8 KiB`;
- uma conexão remota ativa.

## QA físico antes de fechar #417/#422

Com o servidor Home Music e WAN desligados:

1. instalar APK do mesmo head usado no PWA;
2. abrir o modo offline e gerar QR novo;
3. parear pelo transporte esperado da plataforma: direto no Android/Chrome ou bridge no iPhone/iPad;
4. confirmar challenge/join e abertura automática do receiver;
5. trocar offer/answer/ICE;
6. abrir `home-music-media-v1` com o GeckoView 126;
7. reproduzir duas faixas e exercer comandos essenciais;
8. bloquear/colocar o celular em background por período prolongado e verificar recuperação de `disconnected` transitório;
9. provocar perda real de rede e confirmar estado terminal/novo QR;
10. validar QR expirado/regenerado, AP/client isolation e cleanup;
11. religar backend/WAN e confirmar modo online;
12. registrar versões do celular/browser, Android/BTV, GeckoView e comportamento observado.

## Evidência e suporte

O CI cobre contrato, vetores HMAC Web/Android, autenticação por request, TTL/replay, receiver empacotado, bridge iOS, WebRTC/DataChannel Chromium, fila de mídia bounded, ausência de requests `/api/*` durante playback LAN, `disconnected` recuperável e falha terminal real.

Isso não comprova sozinho firmware, Local Network Access, lifecycle de browser mobile ou todas as condições da LAN real. O caminho principal iPhone + BTV já foi exercitado fisicamente, mas suporte final só deve ser registrado após concluir o roteiro e anotar versões/resultados nas issues #417/#422.
