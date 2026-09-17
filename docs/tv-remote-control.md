# Controle remoto da TV pelo celular

O modo TV do Home Music permite usar um celular como controle remoto da reprodução. A TV continua dona do player canônico; as superfícies remotas no celular não criam `<audio>` nem mantêm um segundo player.

Há dois modos relacionados, mas com fronteiras diferentes:

- **remoto online**: celular e TV estão autenticados na mesma conta e a sessão REST/SSE do servidor fornece ownership e signaling;
- **remoto LAN offline**: celular e TV pareiam por sessão efêmera `home-music-lan-remote-v2`, sem backend durante a sessão.

Quando uma faixa já está baixada no celular, os dois modos podem reutilizar o mesmo WebRTC/DataChannel para enviar os bytes diretamente à TV. Detalhes de mídia: [`tv-offline-cast.md`](tv-offline-cast.md).

## Fluxo online

1. Ao montar o modo TV, `useTvRemoteSession` prepara uma sessão efêmera em background e começa a publicar o estado do player.
2. O card **Controle pelo celular** permanece disponível na TV.
3. Ao ativar o card, a TV exibe o QR/URL da sessão.
4. O QR é gerado localmente no frontend; o endereço de pareamento não é enviado a serviço externo.
5. Se necessário, o celular autentica com a mesma conta e abre `/remote/<sessionId>`.
6. A rota remota sinaliza presença; o QR pode ser escondido quando o controlador realmente carrega.
7. Comandos/snapshots online usam a sessão remota do backend.
8. Em paralelo, offer/answer/ICE podem abrir `home-music-media-v1` para mídia P2P.

A sessão preparada em background não significa que a interface de pareamento esteja aberta. Reabrir o card pode reapresentar o QR da sessão ativa; regenerar encerra a sessão anterior e cria outra.

## Comandos e estado

O contrato compartilhado de controle suporta, conforme a superfície exposta:

- play/pause (`toggle-play`);
- faixa anterior (`previous`);
- próxima faixa (`next`);
- alternar aleatório (`toggle-shuffle`);
- alternar repetição (`cycle-repeat`);
- escolher uma faixa (`play-track`);
- seek quando disponibilizado pela superfície/contrato.

O snapshot publicado pela TV contém estado suficiente para renderizar now playing e controles, incluindo faixa atual, título, artista, reprodução, posição/duração e estado de shuffle/repeat quando disponível.

Eventos de signaling carregam somente offer/answer/ICE validados. Bytes de áudio não entram no SSE nem nas rotas REST.

## Modo LAN offline

O modo LAN separa **sinalização da sessão** de **peer/controle/mídia**:

1. o PWA lê o QR LAN sem sair da origin Home Music;
2. challenge/join autenticam a sessão efêmera;
3. offer/answer/ICE trafegam pelo transporte LAN;
4. o receiver offline responde pelo serviço loopback;
5. quando o DataChannel abre, comandos, snapshots e mídia usam o peer comum;
6. o backend Home Music deixa de fazer parte da sessão.

Android/desktop usam o transporte HTTP LAN direto quando suportado. iPhone/iPad usam o bridge local top-level + `postMessage` para adaptar signaling; segredo do QR e HMAC permanecem no PWA, e o bridge não transporta mídia.

O protocolo LAN detalhado está em [`tv-offline-lan-protocol.md`](tv-offline-lan-protocol.md).

### Abertura automática do receiver

Após um `join` LAN autenticado, o serviço Android notifica a Activity para abrir o receiver offline automaticamente. A notificação ocorre uma vez para aquele join válido; replay não abre novamente.

**Abrir receiver offline** continua disponível como fallback manual, mas o happy path não exige esse clique adicional.

### Recuperação do WebRTC

`RTCPeerConnection.connectionState = disconnected` é tratado como estado transitório. Não existe mais timeout fixo que converta esse estado sozinho em erro terminal.

- `disconnected` → UI volta para conectando/recuperando sem encerrar o peer;
- retorno a `connected` → estado pode voltar a `open` se o DataChannel continua aberto;
- `failed` e `closed` continuam terminais;
- fechamento/erro real do DataChannel continua terminal.

Isso permite tolerar oscilações de background/lock em mobile sem reutilizar sessão inválida ou esconder perda real de conexão. Se o peer/DataChannel realmente falhar, a recuperação segura continua sendo novo pareamento/QR; não há ICE restart complexo nesta fase.

## Presença e heartbeat online

No modo online, a TV publica mudanças materiais e heartbeat periódico. A sessão remota do servidor é efêmera, process-local e limitada por usuário.

`EventSource` aberto significa apenas que o controlador alcança o servidor. O estado de TV realmente conectada depende também do snapshot/heartbeat recebido da TV.

O modo LAN não depende desse heartbeat do backend depois que o DataChannel está estabelecido.

## Segurança

### Online

- endpoints exigem autenticação Home Music;
- a sessão pertence ao usuário que a criou;
- mutações usam `X-Home-Music-Request: 1` além do cookie same-origin;
- identificadores de sessão são opacos e efêmeros;
- sinalização WebRTC possui validação e limites.

### LAN

- QR não contém credenciais da conta Home Music;
- challenge/join e requests remotos usam HMAC, TTL, nonces e proteção contra replay;
- regenerar/expirar sessão invalida material anterior;
- o bridge iOS é allowlist de operações de signaling, não proxy arbitrário;
- segredo do QR e derivação HMAC permanecem no PWA;
- áudio e comandos depois do pareamento usam WebRTC/DataChannel.

Nos dois modos, cache offline e object URLs permanecem locais/transitórios, e o celular não inicia reprodução local quando a TV é o destino.

## Composição do frontend

`App.tsx` seleciona a superfície autenticada `/remote/<sessionId>` antes de `AuthenticatedApp`, impedindo que o controle online inicialize o player normal do celular.

Na TV, `AuthenticatedApp` continua dono de `useCrossfadeAudioPlayer`. O peer apenas entrega comandos/mídia ao mesmo player.

Quando uma faixa P2P é recebida, ela é registrada como object URL transitório por `trackId`. O mesmo player prefere essa fonte quando aplicável, sem criar player paralelo.

No modo offline local, o `OfflineApp` permanece montado no celular para preservar Cache Storage, coleções e a identidade offline já persistida.

## Foco e acessibilidade

A TV define o foco inicial ao montar a experiência, mas não o redefine a cada troca de faixa. Assim autoplay, Next ou escolha remota não interrompem a navegação por D-pad.

No celular, navegação entre controle e biblioteca preserva foco útil. Erros de seleção/envio são exibidos próximos à ação que falhou; progresso de transmissão usa região `aria-live` separada.

A cor de destaque extraída da capa é normalizada para preservar contraste mínimo de 3:1 com os ícones brancos dos controles principais.

## Testes e CI

A cobertura automatizada inclui:

- parser de rota, comandos, snapshots e presença online;
- signaling WebRTC e protocolo binário;
- limites, cache offline, object URLs e ordem `transferência -> media-ready -> play-track`;
- controle remoto em dois contexts de navegador;
- sessão LAN sem requests `/api/*` durante playback;
- receiver dedicado do APK;
- bridge iOS para signaling;
- fechamento voluntário versus inesperado do DataChannel;
- `disconnected` transitório/prolongado recuperável;
- `disconnected → failed` terminal;
- `join` autenticado abrindo o receiver apenas uma vez.

Os E2Es promovidos incluem:

- `e2e/tests/tv-remote-control.spec.ts`;
- `e2e/tests/tv-offline-cast.spec.ts`;
- `e2e/tests/tv-offline-lan.spec.ts`;
- `e2e/tests/tv-offline-lan-bridge.spec.ts`.

## Limitações e validação física

O fluxo online continua dependente de uma única instância do servidor para a sessão process-local. O modo LAN exige PWA/downloads previamente disponíveis, mesma rede local e capacidade de transporte compatível com a plataforma.

No iPhone + BTV, QA físico já confirmou o caminho principal bridge → WebRTC/DataChannel → envio de música → reprodução. As rodadas físicas posteriores identificaram problemas de lifecycle e motivaram os PRs #427 e #430.

Ainda falta registrar a homologação final nas issues #417/#422, incluindo background/lock prolongado, perda real de rede, QR expirado/regenerado, AP/client isolation, comportamento de popup/bridge e versões exatas de iOS/browser/BTV/GeckoView.

Não declarar compatibilidade física completa além da evidência registrada.
