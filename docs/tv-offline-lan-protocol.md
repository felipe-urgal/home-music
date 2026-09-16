# Home Music TV — protocolo LAN offline v1

## Objetivo

`home-music-lan-remote-v1` permite parear o PWA Home Music já instalado no celular com o BTV 11 pela mesma LAN quando **WAN e servidor Home Music estão indisponíveis**.

O protocolo local não substitui a conta Home Music. Ele autoriza somente uma sessão efêmera entre o celular que possui o segredo exibido pela TV e o receiver daquele aparelho.

## Fronteiras

- O PWA permanece na origin Home Music para continuar acessando Cache Storage e manifestos offline.
- O APK da TV hospeda HTTP local somente para bootstrap, challenge/join e sinalização WebRTC.
- O receiver offline roda no GeckoView e fala com o serviço nativo por loopback.
- Depois que o RTCDataChannel abre, mídia, comandos e estado usam o peer; o HTTP local não é proxy de áudio.
- Nenhum cookie, username, senha, token de sessão ou user id Home Music é requisito do protocolo LAN.

## Compatibilidade inicial

O alvo do MVP é Android/Chrome com Local Network Access disponível para uma aplicação HTTPS alcançar `http://<ipv4-privado-da-tv>:<porta>` após ação explícita do usuário. O hardware alvo é BTV 11 com GeckoView 126 no receiver.

O suporte real deve ser confirmado no spike físico da issue #417 antes de considerar a matriz abaixo como garantida:

| Ambiente | Estado inicial |
| --- | --- |
| Chrome Android com Local Network Access | alvo do MVP; validar fisicamente |
| PWA instalado | alvo principal |
| aba normal na mesma origin | validar; não assumir paridade com PWA |
| GeckoView 126 no BTV 11 | receiver alvo; validar DataChannel sem STUN/TURN |
| Safari/iOS | não validado nesta fase |
| redes com AP/client isolation | não suportadas |

WebSocket local não é requisito de v1. Bootstrap/sinalização usam HTTP `fetch` + polling/long-poll para reduzir dependência de permissões e comportamento de WebSocket na rede local.

## QR

Texto canônico:

```text
home-music://tv-lan?version=home-music-lan-remote-v1&host=192.168.1.40&port=43123&session=<id>&secret=<segredo>&expires=<epoch-ms>
```

Campos:

- `version`: exatamente `home-music-lan-remote-v1`;
- `host`: IPv4 privado RFC1918 (`10/8`, `172.16/12`, `192.168/16`);
- `port`: `1024..65535`;
- `session`: token base64url/URL-safe aleatório de alta entropia;
- `secret`: segredo base64url/URL-safe aleatório de alta entropia, diferente de qualquer credencial Home Music;
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

### 3. Prova

A mensagem autenticada é UTF-8, exatamente:

```text
home-music-lan-remote-v1
<sessionId>
<clientNonce>
<tvNonce>
<expiresAt>
```

`proof = base64url(HMAC-SHA256(secret, mensagem))`.

O servidor local compara a prova em tempo constante. Challenge expirado, nonces reutilizados, segredo consumido ou sessão regenerada são rejeitados.

### 4. Join

Após prova válida, o segredo do QR é marcado como consumido para novos joins. A TV retorna um `sessionToken` aleatório e a expiração da sessão estabelecida. Requisições autenticadas seguintes usam o token efêmero; o segredo original não precisa continuar trafegando.

No MVP existe no máximo **um remoto ativo por sessão**.

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
- o serviço deve aplicar rate limit por IP/sessão e encerrar abuso sem afetar o receiver local.

Sem STUN/TURN público no modo LAN v1. O peer deve usar candidates host/local e falhar explicitamente quando a rede bloquear comunicação entre clientes.

## Lifecycle

- TTL do QR/challenge: 2 min;
- TTL máximo da sessão estabelecida sem renovação válida: 30 min;
- regenerar QR invalida secret, challenge, token e mailbox anteriores;
- fechar pareamento/receiver limpa material efêmero;
- mudança de IP invalida o QR antigo e exige novo pareamento;
- Activity/app encerrado fecha listener;
- reconnect só é permitido enquanto a mesma sessão/token continuar válida;
- blobs de mídia continuam transitórios e são revogados no receiver.

## CORS e Local Network Access

O serviço LAN deve responder somente aos métodos/headers necessários. Para requests vindos do PWA, a origin permitida deve ser validada conforme configuração/contrato do app; endpoints autenticados não devem usar uma política permissiva indiscriminada.

Preflight/headers exigidos pela implementação de Local Network Access do browser alvo devem ser cobertos pelo spike físico. Negação da permissão deve gerar um estado separado de “TV não encontrada”.

## Threat model

### Protegido

- dispositivo aleatório da LAN não controla a TV apenas conhecendo IP/porta;
- captura de um request antigo não autoriza replay indefinido;
- QR antigo deixa de valer ao expirar/regenerar;
- credenciais Home Music não são expostas ao serviço LAN;
- payloads grandes/filas sem limite não podem crescer indefinidamente;
- sessão fechada não deixa listener/token reaproveitável.

### Não protegido nesta fase

- atacante que fotografa/captura o QR válido antes do uso pode tentar parear durante a janela curta;
- rede local maliciosa pode causar DoS/bloquear tráfego;
- modo offline não fornece acesso entre redes diferentes;
- não há identidade persistente do celular: a confiança é o segredo efêmero apresentado fisicamente pela TV.

## Limites v1

- pairing TTL: `120000 ms`;
- established session TTL: `1800000 ms`;
- poll: `25000 ms`;
- pending signals: `128`;
- HTTP request body: `327680 bytes`;
- SDP: `256 KiB` (mesmo contrato online);
- ICE candidate: `8 KiB`;
- uma conexão remota ativa.

## Spike físico obrigatório antes de fechar #417

Com o servidor Home Music e WAN desligados:

1. instalar APK contendo um endpoint temporário/implementação inicial do serviço LAN;
2. abrir o PWA já instalado no Chrome Android;
3. a partir de gesto explícito, executar `fetch(http://<ip-tv>:<porta>/health)`;
4. confirmar prompt/permissão Local Network Access e CORS/preflight;
5. negar a permissão e confirmar erro distinguível;
6. conceder e executar challenge/join;
7. trocar offer/answer/ICE por polling;
8. abrir `home-music-media-v1` entre Chrome e GeckoView 126 sem STUN/TURN;
9. repetir com WAN desligada;
10. registrar versão do Chrome, Android, BTV/GeckoView e comportamento observado.

Se o browser alvo não permitir HTTPS → HTTP LAN de forma utilizável, #417 deve ser reaberta como decisão arquitetural antes de avançar para uma implementação completa; não mascarar a limitação com fallback inseguro.
