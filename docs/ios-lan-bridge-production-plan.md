# Bridge LAN para iOS — estado de produção e QA

Status: **implementação incorporada na `main`; homologação física final pendente**  
Relacionados: #417, #422, PRs #427 e #430

## Contexto

O modo TV totalmente offline usa `home-music-lan-remote-v2`: o PWA lê o QR efêmero, faz `challenge`/`join`, troca signaling e, depois que o `RTCDataChannel` abre, envia mídia e comandos diretamente para a TV.

No iPhone/iPad, o PWA HTTPS não usa o mesmo `fetch()` HTTPS → HTTP privado do transporte LAN direto. O caminho implementado abre uma página HTTP local da BTV como navegação top-level e usa `postMessage` para adaptar somente o signaling.

QA físico em 17/09/2026 confirmou o caminho principal:

```text
iPhone -> /bridge -> challenge/join/signaling -> WebRTC/DataChannel
       -> envio de música offline -> reprodução na BTV
```

A rodada física também revelou instabilidades de lifecycle. O PR #427 endureceu detecção/cleanup/UX; o PR #430 passou a abrir o receiver automaticamente após `join` autenticado e deixou `disconnected` como estado recuperável, sem timeout terminal arbitrário.

A implementação está mergeada. O que falta é fechar a evidência física de estabilidade e compatibilidade, não uma segunda arquitetura.

## Arquitetura atual

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
  ├─ complete
  └─ close
       │
       ▼
LanPairingServer / home-music-lan-remote-v2
```

Depois que o DataChannel abre, o bridge deixa de participar da sessão de mídia/controle.

## Invariantes implementados

- `home-music-lan-remote-v2` continua sendo o protocolo LAN;
- o QR não contém credenciais Home Music;
- o `secret` permanece no PWA;
- proof/HMAC são calculados no PWA;
- o bridge não deriva chaves nem persiste segredo/token/autorização;
- o bridge não é proxy HTTP genérico;
- allowlist: `challenge`, `join`, `signal-send`, `signal-poll`, `complete`, `close`;
- WebRTC/DataChannel continuam no PWA/receiver;
- mídia não passa pelo bridge;
- Android/desktop preservam o transporte LAN direto;
- regeneração/expiração/fechamento obedecem às regras v2;
- `event.source`, `event.origin`, `channelId`, `requestId`, tamanho e timeout são validados;
- requests tardias de tentativa anterior são ignoradas;
- `complete` encerra signaling/bridge sem enviar `/close?role=remote` no handoff normal;
- popup bloqueado, timeout, bridge indisponível e sessão expirada têm erro distinguível;
- o bridge tenta `window.close()` após P2P pronto e mantém instrução manual se o browser bloquear o fechamento.

Contrato detalhado: [`ios-lan-bridge-protocol-v1.md`](ios-lan-bridge-protocol-v1.md).

## Receiver e lifecycle depois do #430

Depois de um `join` autenticado, `LanPairingSession` notifica a camada Android para iniciar o receiver offline uma única vez. O usuário não deve precisar clicar em **Abrir receiver offline** no happy path; o botão permanece como fallback.

No peer WebRTC:

- `disconnected` é transitório e não fecha a sessão sozinho;
- retorno a `connected` pode restaurar `open` sem novo QR se o DataChannel continua válido;
- `failed`, `closed` e fechamento/erro real do DataChannel são terminais;
- não há ICE restart/reconexão automática complexa nesta fase;
- falha real continua exigindo novo pareamento/QR.

Esse comportamento existe para tolerar background/lock e oscilações breves sem enfraquecer TTL/replay protection ou reutilizar sessão inválida.

## Cobertura automatizada

### Web/contrato

Coberto por testes:

- handshake e channel binding;
- `event.source`/`event.origin` inválidos;
- IDs incorretos/duplicados;
- timeout, abort e resposta tardia;
- allowlist fechada;
- challenge/join/signals via bridge;
- HMAC/proof permanecendo no PWA;
- `secret` ausente do bridge;
- signaling encerrado após P2P;
- caminho LAN direto preservado;
- `disconnected` transitório/prolongado recuperável;
- `disconnected → failed` terminal.

### E2E/CI

`e2e/tests/tv-offline-lan-bridge.spec.ts` cobre:

- `bridge.html`/`bridge.js` reais;
- `challenge → join → signals → DataChannel`;
- handoff `complete`;
- ausência de `/close?role=remote` no handoff normal;
- mídia continuando no DataChannel;
- ausência de tráfego adicional do bridge depois do P2P.

Os gates principais também mantêm controle remoto online, offline cast, LAN totalmente offline e regressões gerais.

### Android TV

O build valida:

- receiver offline empacotado;
- `bridge.html` e `bridge.js` presentes no APK;
- HTML referenciando `/bridge.js`;
- script não vazio;
- testes JVM, `assembleDebug` e `lintDebug`.

## Evidência física existente

Foi observado em iPhone + BTV real:

- navegação top-level HTTPS → HTTP local para abrir o bridge;
- `window.opener`/`postMessage` suficientes para o handoff;
- segredo do QR permanecendo fora do bridge;
- signaling concluindo WebRTC/DataChannel;
- envio de faixa offline;
- reprodução na BTV.

Essa evidência comprova viabilidade e o caminho principal, mas não a matriz completa de estabilidade.

## QA físico restante

Usar APK e PWA do mesmo estado de código, com servidor Home Music e WAN desligados.

### Happy path

- [ ] cold start da BTV;
- [ ] cold start do PWA no iPhone;
- [ ] confirmar biblioteca/coleções offline;
- [ ] gerar QR novo e conectar via bridge;
- [ ] confirmar que o receiver abre automaticamente após o `join`;
- [ ] confirmar DataChannel aberto;
- [ ] reproduzir faixa A somente na TV;
- [ ] play/pause, seek, next/previous;
- [ ] reproduzir faixa B;
- [ ] confirmar fechamento automático do bridge ou fallback manual claro.

### Lifecycle

- [ ] background/foreground durante signaling;
- [ ] bloquear iPhone por pelo menos 30 s após P2P aberto;
- [ ] confirmar que `disconnected` transitório não destrói a sessão;
- [ ] desbloquear e confirmar retorno dos controles sem novo QR quando o WebRTC se recuperar;
- [ ] manter sessão ativa por período maior para tentar reproduzir quedas intermitentes.

### Falhas reais

- [ ] desligar Wi-Fi durante signaling;
- [ ] desligar Wi-Fi depois do P2P aberto;
- [ ] confirmar que falha terminal/fechamento real exige novo QR;
- [ ] QR expirado;
- [ ] QR regenerado durante conexão;
- [ ] fechar bridge antes do join/polling;
- [ ] fechar receiver durante conexão;
- [ ] TV fora da LAN/inalcançável;
- [ ] AP/client isolation;
- [ ] tentativa de reutilizar sessão/autorização consumida.

### Recuperação

- [ ] reparear com QR novo depois de falha real;
- [ ] confirmar que QR antigo não volta a funcionar;
- [ ] religar backend/WAN e confirmar modo online íntegro.

## Registro obrigatório

Para concluir #417/#422, registrar:

- modelo do iPhone;
- versão do iOS;
- browser/PWA e versão;
- firmware/Android da BTV;
- GeckoView do APK;
- commit/APK utilizado;
- comportamento do popup/aba bridge;
- resultado de background/lock;
- resultado de perda real de rede e repareamento;
- playback/controles;
- limitações/reprodução de erros.

## Fora de escopo

- transformar o bridge em servidor de mídia;
- enviar áudio por `postMessage`;
- substituir WebRTC/DataChannel;
- criar proxy HTTP genérico para a LAN;
- redes diferentes/NAT/remoto;
- mDNS/discovery automático;
- instalação inicial do PWA sem internet;
- download de novas músicas com backend indisponível;
- afirmar suporte a browser/hardware não testado fisicamente.
