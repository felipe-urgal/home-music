# Plano de produção — bridge LAN para iOS

Status: **implementação automatizada concluída; QA físico final pendente no PR #425**  
Branch: `spike/ios-lan-bridge`  
Relacionados: #417, #422

## Contexto

O modo TV totalmente offline usa `home-music-lan-remote-v2`: o PWA lê o QR efêmero, faz `challenge`/`join`, usa sinalização HTTP autenticada para abrir WebRTC e, depois que o `RTCDataChannel` abre, envia mídia e comandos diretamente para a TV.

No iPhone/iOS foi identificado um bloqueio específico de plataforma: o Home Music em HTTPS consegue alcançar a BTV por navegação top-level HTTP, mas o browser no iOS não consegue usar o `fetch()` HTTPS → HTTP usado pelo transporte LAN direto.

O spike inicial já validou fisicamente em iPhone real que:

- Home Music HTTPS abre `http://<ip-tv>:<porta>/bridge` como navegação top-level;
- a página local preserva `window.opener`;
- PWA e bridge trocam mensagens por `postMessage`;
- o `secret` do QR não precisa ser enviado ao bridge.

A evolução deste PR transforma essa prova em um adaptador de transporte para a sinalização LAN. O bridge não transporta mídia e não substitui o protocolo v2.

## Arquitetura alvo

```text
Home Music HTTPS (PWA)
  ├─ QR/secret + proof/HMAC
  ├─ RTCPeerConnection + RTCDataChannel
  ├─ mídia offline + comandos
  │
  └─ postMessage
       │
       ▼
BTV HTTP /bridge (top-level)
  ├─ challenge
  ├─ join
  ├─ signal-send / signal-poll
  ├─ complete (handoff local após P2P)
  └─ close (encerramento de sessão antes do handoff)
       │
       ▼
LanPairingServer / home-music-lan-remote-v2
```

## Invariantes

- [x] manter `home-music-lan-remote-v2` como protocolo LAN;
- [x] não colocar credenciais da conta Home Music no QR;
- [x] manter o `secret` efêmero do QR no PWA;
- [x] calcular `proof` de `join` no PWA;
- [x] calcular a autorização HMAC no PWA;
- [x] bridge não deriva chaves nem persiste segredo/token/autorização;
- [x] bridge não é proxy HTTP genérico para a LAN;
- [x] WebRTC/DataChannel continuam no PWA/receiver;
- [x] mídia continua no DataChannel P2P;
- [x] Android/desktop preservam o transporte direto;
- [x] regeneração/expiração/fechamento continuam usando as regras v2;
- [x] PR permanece draft até o fluxo físico completo ser validado no iPhone/BTV.

## 1. Spike inicial e limpeza de diagnóstico

- [x] disponibilizar `/bridge` e `/bridge.js` no serviço LAN da BTV;
- [x] abrir bridge HTTP por ação explícita do usuário;
- [x] validar `window.opener` no iPhone real;
- [x] validar `postMessage` HTTPS ↔ HTTP no iPhone real;
- [x] confirmar que o bridge não precisa receber o `secret`;
- [x] remover botão/mensagem de diagnóstico do fluxo normal;
- [x] remover a operação temporária `probe` do contrato PWA e do runtime BTV;
- [ ] decidir após o QA físico se `docs/spikes/ios-lan-bridge-probe.html` ainda tem valor diagnóstico ou deve ser removido.

## 2. Contrato interno do bridge

Implementação: `apps/web/src/tv-lan-bridge-protocol.ts`.  
Documento detalhado: [`ios-lan-bridge-protocol-v1.md`](ios-lan-bridge-protocol-v1.md).

- [x] `version: 1`;
- [x] `channelId` aleatório por abertura;
- [x] `requestId` por operação;
- [x] `expiresAt` por request;
- [x] validação estrita de `event.source` e `event.origin`;
- [x] shape fechado de mensagens;
- [x] limite serializado de 2 MiB;
- [x] timeout/cancelamento/cleanup;
- [x] respostas tardias de outra tentativa são ignoradas;
- [x] allowlist final contém somente `challenge`, `join`, `signal-send`, `signal-poll`, `complete` e `close`.

Não existe campo arbitrário de URL, host, método ou headers.

## 3. Relay real na BTV

Arquivos principais:

- `android-tv/app/src/main/assets/bridge.html`;
- `android-tv/app/src/main/assets/bridge.js`;
- `android-tv/app/src/main/java/com/homemusic/tv/LanPairingServer.java`;
- `android-tv/app/src/main/java/com/homemusic/tv/LanPairingSession.java`.

- [x] `challenge` → `GET /challenge?...`;
- [x] `join` → `POST /join`;
- [x] `signal-send` → `POST /signals?role=remote`;
- [x] `signal-poll` → `GET /signals?role=remote&cursor=...`;
- [x] `close` → `POST /close?role=remote`;
- [x] `complete` é local ao bridge e não chama `/close`;
- [x] targets são reconstruídos de forma determinística;
- [x] requests usam `cache: no-store`, `credentials: omit` e timeout;
- [x] mensagem `postMessage` limitada a 2 MiB;
- [x] body de `signal-send` limitado a 320 KiB;
- [x] response limitada a 2 MiB;
- [x] erros normalizados (`invalid_payload`, `duplicate_request`, `timeout`, `network_error`, `http_error`, `invalid_response`, `response_too_large`);
- [x] requests distintas podem concorrer durante ICE/polling;
- [x] TTL, replay protection, rate limit e autenticação continuam no `LanPairingServer`/`LanPairingSession`;
- [x] `/receiver/*` continua loopback-only;
- [x] bridge não exibe/persiste/loga `secret`, `proof` ou `Authorization`.

## 4. Transporte bridge no PWA

Arquivos principais:

- `apps/web/src/tv-lan-transport.ts`;
- `apps/web/src/tv-lan-bridge-client.ts`;
- `apps/web/src/tv-lan-remote-client.ts`;
- `apps/web/src/tv-lan-bridge-client.test.ts`;
- `apps/web/src/tv-lan-remote-bridge-transport.test.ts`.

- [x] abstração `TvLanTransport`/`TvLanTransportFactory`;
- [x] transporte HTTP direto preservado;
- [x] transporte bridge com `window.open` + `postMessage`;
- [x] `challenge` via bridge;
- [x] `join` via bridge com `proof` calculado no PWA;
- [x] `signals` com HMAC calculado no PWA;
- [x] cursor/polling compartilhados com o caminho direto;
- [x] `AbortSignal`, timeout e cleanup preservados;
- [x] `secret` nunca é enviado ao transport bridge;
- [x] `finish()` separa handoff P2P de `close()` de sessão;
- [x] ao abrir o DataChannel, signaling remoto e receiver são finalizados localmente;
- [x] late ICE depois do handoff é ignorado sem reabrir signaling;
- [x] bridge recebe `complete`, encerra listeners/pending requests e tenta fechar a janela sem derrubar o P2P.

## 5. Seleção do transporte e UX

Implementação: `apps/web/src/tv-lan-transport-selection.ts` e `apps/web/src/TvLanQrScanner.tsx`.

- [x] iPhone/iPad/iPadOS usam explicitamente o bridge;
- [x] Android/desktop continuam no caminho direto;
- [x] não existe fallback silencioso direto → bridge;
- [x] popup do bridge exige gesto explícito do usuário;
- [x] leitura automática do QR em plataforma bridge apenas preenche o valor e pede toque em `Conectar`;
- [x] fallback manual de QR preservado;
- [x] erro acionável para popup bloqueado;
- [x] erro acionável para timeout/bridge indisponível;
- [x] erro acionável para sessão recusada/expirada;
- [x] bridge orienta retorno ao Home Music enquanto aguarda o P2P;
- [x] `complete` mostra P2P pronto e tenta `window.close()`;
- [x] se `window.close()` for bloqueado, a página mantém instrução de retorno/fechamento manual;
- [ ] confirmar fisicamente no iOS o comportamento de background/foreground e o fallback de fechamento bloqueado.

## 6. Cobertura automatizada — Web

- [x] handshake `ready`/channel binding;
- [x] `event.source` incorreto ignorado;
- [x] `event.origin` incorreto ignorado;
- [x] channel/request incorretos ignorados;
- [x] request/response correlacionados por ID;
- [x] timeout do cliente bridge;
- [x] popup bloqueado;
- [x] abort durante request;
- [x] response tardia ignorada;
- [x] operação fora da allowlist rejeitada;
- [x] operação temporária `probe` rejeitada após limpeza;
- [x] challenge/join/signals via abstração bridge;
- [x] HMAC/proof permanecem no PWA;
- [x] `secret` não chega ao bridge;
- [x] polling e erro de sessão expirada/regenerada limpam o transport;
- [x] handoff `complete` remove listener/window refs;
- [x] signaling para após P2P sem chamar `/close`;
- [x] receiver para signaling após P2P e ignora late ICE;
- [x] caminho direto continua coberto.

## 7. Cobertura automatizada — E2E/CI

Arquivo: `e2e/tests/tv-offline-lan-bridge.spec.ts`.

- [x] fixture real do `bridge.html`/`bridge.js`;
- [x] `challenge → join → signals → DataChannel` usando bridge;
- [x] popup bridge encerra após handoff P2P;
- [x] handoff não envia `/close?role=remote`;
- [x] mídia continua no DataChannel depois do signaling;
- [x] não há tráfego LAN adicional do bridge após P2P;
- [x] E2E direto de LAN permanece no workflow;
- [x] regressões online/offline existentes permanecem no workflow;
- [x] CI executa o novo E2E bridge em `desktop-chromium`.

O primeiro E2E bridge observava uma mensagem transitória da janela e foi ajustado para estados estáveis: P2P conectado, operações de signaling via bridge, ausência de `/close` no handoff e popup encerrado.

## 8. Cobertura Android TV / APK

- [x] build valida que `bridge.html` e `bridge.js` existem antes do APK;
- [x] build valida que `bridge.html` referencia `/bridge.js` e que o script não está vazio;
- [x] workflow Android executa unit tests, assemble e lint;
- [x] workflow inspeciona o APK e exige `assets/bridge.html` e `assets/bridge.js` além do receiver;
- [x] testes existentes continuam cobrindo sessão, TTL, replay e autenticação do protocolo LAN;
- [ ] teste Android dedicado do roteamento/MIME do bridge pode ser adicionado se o QA físico revelar necessidade; não é necessário para duplicar o E2E browser já existente.

## 9. Gates

Evidência automatizada previamente verde após a integração principal:

- CI #1978 no head `629ff9336f06f4f402af641610f200f9e635b8ed`;
- Android TV #131 no mesmo ciclo de validação.

Depois disso foram adicionados testes de lifecycle/cleanup e a remoção final de `probe`. O head final precisa novamente apresentar, no **mesmo commit**:

- [ ] Quality gate verde;
- [ ] TV regression gate verde;
- [ ] Security regression gate verde;
- [ ] Backup restore smoke verde;
- [ ] Mobile crossfade E2E verde;
- [ ] TV remote control E2E verde;
- [ ] TV offline cast E2E verde;
- [ ] TV fully offline LAN E2E verde;
- [ ] TV iOS LAN bridge E2E verde;
- [ ] Personal data import E2E verde;
- [ ] Library Assistant E2E verde;
- [ ] Android TV build/lint/testes verde;
- [ ] verificação dos assets do bridge no APK verde.

Esses checkboxes devem ser atualizados somente com evidência do head final.

## 10. QA físico obrigatório — iPhone + BTV 11

Pré-condições:

- APK do head final instalado na BTV 11;
- Home Music/PWA disponível no iPhone;
- pelo menos duas faixas baixadas;
- iPhone e TV na mesma LAN;
- servidor Home Music desligado;
- WAN desligada.

Roteiro:

- [ ] cold start da BTV sem backend/WAN;
- [ ] abrir receiver offline;
- [ ] cold start do Home Music no iPhone;
- [ ] confirmar biblioteca offline;
- [ ] gerar QR novo;
- [ ] usar leitura/fallback manual do QR;
- [ ] conectar via bridge;
- [ ] completar challenge/join;
- [ ] completar offer/answer/ICE;
- [ ] confirmar DataChannel aberto;
- [ ] reproduzir faixa A somente na TV;
- [ ] pause/play;
- [ ] seek;
- [ ] next/previous;
- [ ] reproduzir faixa B;
- [ ] background/foreground do Home Music durante signaling e após P2P;
- [ ] confirmar fechamento automático ou fallback manual do bridge;
- [ ] regenerar QR e confirmar invalidação da sessão anterior;
- [ ] encerrar receiver e confirmar cleanup;
- [ ] religar WAN/backend e confirmar modo online íntegro.

Registrar:

- modelo do iPhone;
- versão do iOS;
- Safari/Chrome e versão;
- firmware/Android da BTV;
- GeckoView do APK;
- comportamento de popup/aba bridge;
- latência aproximada do pareamento;
- resultado de playback/controles;
- qualquer erro reproduzível.

## 11. Testes físicos negativos

- [ ] TV fora da LAN/inalcançável;
- [ ] popup bloqueado;
- [ ] QR expirado;
- [ ] QR regenerado durante conexão;
- [ ] fechar bridge antes do join;
- [ ] fechar bridge durante polling;
- [ ] fechar receiver durante conexão;
- [ ] desligar Wi-Fi durante sinalização;
- [ ] desligar Wi-Fi durante transferência de mídia;
- [ ] AP/client isolation;
- [ ] sessão expirada após estabelecida;
- [ ] tentativa de reutilização de mensagem/autorização consumida quando aplicável.

## 12. Documentação de produção após QA físico

Somente depois do teste real, atualizar o que foi efetivamente validado em:

- [ ] `docs/tv-offline-lan-protocol.md`;
- [ ] `docs/tv-offline-cast.md`;
- [ ] `docs/tv-remote-control.md`;
- [ ] `docs/android-tv.md`;
- [ ] `android-tv/README.md`;
- [ ] `e2e/README.md`, se necessário;
- [ ] matriz real de compatibilidade iOS/BTV;
- [ ] limitações de popup/lifecycle e AP/client isolation;
- [ ] procedimento físico reproduzível.

## 13. Limpeza final antes de ready/merge

- [x] botão/mensagem de teste removidos da UI normal;
- [x] operação `probe` removida do contrato e do runtime;
- [x] bridge não expõe fetch/proxy arbitrário;
- [x] lógica de proof/HMAC não foi duplicada no bridge;
- [x] cleanup automatizado de listeners/timers/polling/window refs coberto;
- [ ] revisar se o HTML de spike antigo deve ser mantido ou removido;
- [ ] revisar diff completo contra `main` no head final;
- [ ] atualizar descrição do PR com os gates do head final;
- [ ] registrar QA físico;
- [ ] completar documentação/matriz de compatibilidade baseada no QA;
- [ ] somente então retirar draft e decidir merge.

## Critérios de aceite finais

- [ ] iPhone real completa pareamento sem `fetch()` HTTPS → HTTP direto;
- [x] bridge automatizado cobre `challenge`, `join` e `signals` mantendo as regras v2;
- [x] `complete` finaliza apenas signaling/bridge após DataChannel aberto;
- [x] secret do QR e derivação HMAC permanecem no PWA;
- [x] mídia automatizada continua no DataChannel P2P;
- [ ] duas faixas offline tocam na BTV real com WAN/backend desligados;
- [ ] pause/play, seek, next/previous funcionam no QA físico;
- [ ] sessão expirada/regenerada não pode ser reutilizada no QA físico;
- [x] cleanup automatizado cobre polling/listeners/timers/popup;
- [x] transporte LAN direto permanece coberto;
- [x] regressões automatizadas do modo TV permanecem cobertas;
- [ ] CI completo aplicável está verde no mesmo head final;
- [ ] Android TV está verde no mesmo head final;
- [ ] QA físico iPhone/BTV está registrado;
- [ ] documentação e matriz de compatibilidade refletem somente o que foi validado.

## Fora de escopo

- transformar o bridge em servidor de mídia;
- enviar áudio por `postMessage`;
- substituir WebRTC/DataChannel;
- alterar o protocolo LAN v2 sem necessidade demonstrada;
- criar proxy HTTP genérico para a rede local;
- redes diferentes/NAT/remoto;
- mDNS/discovery automático;
- instalação inicial do PWA sem internet;
- download de novas músicas com backend indisponível;
- afirmar suporte a browser/hardware não testado fisicamente;
- adicionar dependência nova de scanner QR somente para eliminar o fallback manual.
