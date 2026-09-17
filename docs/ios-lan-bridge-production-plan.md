# Plano de produção — bridge LAN para iOS

Status: **em execução no PR #425**  
Branch: `spike/ios-lan-bridge`  
Relacionados: #417, #422

## Contexto

O modo TV totalmente offline já usa o protocolo `home-music-lan-remote-v2`: o PWA lê o QR efêmero, faz `challenge`/`join`, usa sinalização HTTP autenticada para abrir o WebRTC e, depois que o `RTCDataChannel` abre, envia mídia e comandos diretamente para a TV.

No iPhone/iOS foi identificado um bloqueio específico de plataforma: a página Home Music em HTTPS consegue alcançar a BTV por navegação top-level HTTP, porém Safari e Chrome no iOS não conseguem usar o `fetch()` HTTPS → HTTP que o cliente LAN v2 usa hoje.

O spike deste PR validou fisicamente que:

- o Home Music HTTPS consegue abrir `http://<ip-tv>:<porta>/bridge` como navegação top-level;
- a página local servida pela BTV preserva `window.opener`;
- Home Music e bridge conseguem trocar `PING/PONG` com `postMessage`;
- o segredo do QR não precisa ser enviado para a página bridge para provar essa comunicação.

No head `ad1b7b267698ca6a5e96784152c020ef70b3e4fc`, CI #1937 e Android TV #90 concluíram com sucesso. No head `6071db07ed847dfcf53e6a1778bfae3b95a7bb2c`, após a atividade 2, CI #1939 e Android TV #92 também concluíram com sucesso. Alterações posteriores da atividade 3 exigem nova observação dos gates antes de usar essa evidência como final.

## Objetivo

Transformar o spike em um caminho de produção para iOS sem criar um segundo protocolo de pareamento e sem mudar o transporte de mídia.

A solução alvo é um **adaptador de transporte HTTP local**:

```text
Home Music HTTPS (PWA)
  ├─ mantém QR/secret e criptografia/HMAC
  ├─ mantém RTCPeerConnection + RTCDataChannel
  ├─ mantém mídia offline e comandos
  │
  └─ postMessage
       │
       ▼
BTV HTTP /bridge (top-level)
  ├─ faz somente requests LAN same-origin permitidos
  ├─ challenge
  ├─ join
  ├─ signals
  └─ close
       │
       ▼
LanPairingServer / protocolo home-music-lan-remote-v2
```

O bridge não substitui o protocolo v2. Ele apenas contorna a restrição de `fetch()` cross-scheme do iOS.

## Invariantes

Estas regras não devem ser relaxadas para fazer o bridge funcionar:

- [ ] manter `home-music-lan-remote-v2` como protocolo LAN entre PWA e TV;
- [ ] não colocar username, cookie, token de conta Home Music ou qualquer credencial da conta no QR;
- [ ] manter o `secret` efêmero do QR no PWA;
- [ ] calcular `proof` de `join` no PWA;
- [ ] calcular a autorização HMAC das requests remotas no PWA;
- [ ] o bridge não deriva chaves e não persiste segredo/token/autorização;
- [ ] qualquer material de sessão que atravesse o bridge é transitório, opaco e nunca deve ser logado;
- [ ] bridge não pode virar proxy HTTP genérico para a LAN;
- [ ] WebRTC e DataChannel continuam no PWA/receiver, não no bridge;
- [ ] mídia continua indo pelo DataChannel P2P;
- [ ] Android/Chrome que já funciona pelo transporte direto não pode regredir;
- [ ] regenerar QR, expiração e fechamento continuam invalidando a sessão conforme o protocolo atual;
- [ ] manter PR em draft até o fluxo completo ser comprovado fisicamente no iPhone.

## Atividades

### 1. Congelar a conclusão do spike

- [x] disponibilizar `/bridge` e `/bridge.js` no serviço LAN da BTV;
- [x] abrir bridge HTTP por ação explícita do usuário;
- [x] validar `window.opener` no iPhone real;
- [x] validar `postMessage` HTTPS ↔ HTTP com `PING/PONG` no iPhone real;
- [x] confirmar que o spike não precisa receber o `secret` do QR;
- [ ] remover a UI/textos de diagnóstico do spike quando o fluxo real substituir o teste.

### 2. Definir contrato interno do bridge

Criar um contrato pequeno e versionado para a comunicação PWA ↔ bridge. Esse contrato é interno ao adaptador e **não altera** `home-music-lan-remote-v2`.

Contrato implementado em `apps/web/src/tv-lan-bridge-protocol.ts` e documentado em [`docs/ios-lan-bridge-protocol-v1.md`](ios-lan-bridge-protocol-v1.md). O envelope usa `version: 1`, `channelId`, `requestId`, `expiresAt`, payload JSON e limite serializado de 2 MiB.

Requisitos:

- [x] criar identificador de versão do bridge;
- [x] criar `channelId`/nonce aleatório por abertura;
- [x] correlacionar cada operação com `requestId` único;
- [x] aceitar mensagens somente da janela `opener` esperada;
- [x] validar `event.origin` e `event.source` em ambos os lados;
- [x] rejeitar mensagens com shape desconhecido, IDs inválidos ou payload acima do limite;
- [x] implementar timeout por request;
- [x] implementar cancelamento/cleanup quando PWA, bridge ou sessão fecharem;
- [x] garantir que responses tardias de uma sessão anterior sejam ignoradas.

Operações permitidas são semânticas e fechadas:

- `probe` — temporária enquanto o spike ainda existe;
- `challenge`;
- `join`;
- `signal-send`;
- `signal-poll`;
- `close`.

O bridge não aceita URL arbitrária, host arbitrário, método arbitrário ou headers arbitrários. A atividade 3 passou a executar as operações de produção com targets same-origin determinísticos; `probe` continua apenas enquanto a UI temporária do spike ainda não foi removida.

### 3. Produzir o bridge real na BTV

Arquivos principais:

- `android-tv/app/src/main/assets/bridge.html`;
- `android-tv/app/src/main/assets/bridge.js`;
- `android-tv/app/src/main/java/com/homemusic/tv/LanPairingServer.java`.

Os endpoints `/challenge`, `/join`, `/signals` e `/close` já existem no `LanPairingServer`. O bridge agora os usa como relay same-origin, sem recriar a semântica do protocolo v2.

Atividades:

- [x] confirmar que `/challenge`, `/join`, `/signals` e `/close` já existem e preservam as validações atuais;
- [x] substituir `not_implemented` pelo relay das operações permitidas, mantendo `probe` temporariamente para o spike;
- [x] usar requests same-origin para o próprio `LanPairingServer`;
- [x] reconstruir targets de forma determinística, sem aceitar target arbitrário vindo do PWA;
- [x] aplicar `cache: no-store` e `credentials: omit` às requests de sessão;
- [x] limitar mensagem do bridge a 2 MiB, body LAN a 320 KiB e response a 2 MiB;
- [x] normalizar falhas em `invalid_payload`, `timeout`, `network_error`, `http_error`, `invalid_response` e `response_too_large`;
- [x] não exibir nem registrar segredo, proof, Authorization completa ou payload sensível;
- [x] oferecer estado visual mínimo enquanto o bridge estiver aberto;
- [x] suportar comando `close` e fechamento best-effort da janela após sucesso;
- [x] manter assets `/receiver/*` restritos a loopback; o bridge não cria rota/proxy para esses assets;
- [x] preservar rate limit, TTL, replay protection e validações atuais do `LanPairingServer`/`LanPairingSession`;
- [x] permitir requests distintas concorrentes sem bloquear envio de ICE durante polling e rejeitar `requestId` duplicado em execução.

Contrato detalhado do relay e shapes de payload: [`docs/ios-lan-bridge-protocol-v1.md`](ios-lan-bridge-protocol-v1.md).

### 4. Criar transporte bridge no PWA

Arquivos esperados:

- `apps/web/src/tv-lan-remote-client.ts`;
- novo módulo dedicado ao bridge, se necessário;
- `apps/web/src/TvLanQrScanner.tsx`;
- `apps/web/src/OfflineApp.tsx` apenas se a integração exigir.

Atividades:

- [ ] extrair/introduzir uma abstração de transporte para as requests LAN;
- [ ] manter o transporte HTTP direto atual como caminho existente;
- [ ] adicionar transporte via bridge usando `window.open` + `postMessage`;
- [ ] fazer `challenge` via bridge;
- [ ] calcular `proof` no PWA e fazer `join` via bridge;
- [ ] validar o `join` no PWA exatamente como no caminho direto;
- [ ] calcular `Authorization` HMAC no PWA para `signals` e `close`;
- [ ] enviar/receber sinalização via bridge sem alterar envelopes v2;
- [ ] manter cursor e validações de polling existentes;
- [ ] encerrar bridge/sinalização quando o DataChannel abrir ou a sessão for fechada;
- [ ] manter `AbortSignal`, timeouts e cleanup do cliente atual;
- [ ] não duplicar lógica criptográfica entre transporte direto e bridge;
- [ ] impedir duas conexões/bridges concorrentes para a mesma tentativa de pareamento.

### 5. Estratégia de seleção do transporte

Não fazer fallback silencioso que esconda erro real de rede.

- [ ] preservar transporte direto para plataformas onde ele funciona;
- [ ] definir condição explícita para oferecer/usar bridge no iOS;
- [ ] se houver tentativa direta antes do bridge, distinguir falha de mixed-content/plataforma de TV realmente inalcançável quando tecnicamente possível;
- [ ] evitar abrir popup/aba local sem ação do usuário;
- [ ] manter erro acionável quando popup estiver bloqueado;
- [ ] manter erro acionável quando a TV estiver fora da rede, sessão expirar ou bridge não responder.

### 6. UX do pareamento no iPhone

O objetivo desta entrega é tornar o pareamento funcional; não é necessário introduzir uma biblioteca nova de leitura de QR apenas para substituir o fallback manual.

- [ ] manter validação do payload antes de tentar conectar;
- [ ] manter fallback de colar o conteúdo bruto do QR no iOS;
- [ ] remover o botão `Testar bridge iOS (spike)` quando o bridge real estiver integrado;
- [ ] botão `Conectar` deve disparar fluxo real e sempre produzir estado visível;
- [ ] exibir estados de abertura do bridge, pareamento, conexão P2P, conectado e erro;
- [ ] orientar o usuário quando a janela/aba bridge abrir;
- [ ] fechar automaticamente a janela bridge quando possível após o DataChannel abrir;
- [ ] fornecer fallback de retorno ao Home Music se o iOS não permitir `window.close()`;
- [ ] não mostrar secret/token completo em UI ou diagnóstico.

### 7. Lifecycle e riscos específicos do iOS

O PING/PONG prova comunicação, mas ainda não prova que o ciclo completo de sinalização/WebRTC sobreviverá ao comportamento de abas do iOS.

Validar:

- [ ] opener continua executando enquanto bridge está em foreground;
- [ ] bridge continua processando request/poll enquanto Home Music volta ao foreground;
- [ ] `postMessage` não é perdido durante alternância entre abas/janelas;
- [ ] WebRTC consegue concluir offer/answer/ICE nesse lifecycle;
- [ ] DataChannel abre sem STUN/TURN e sem WAN;
- [ ] bridge pode ser encerrado depois que o DataChannel estiver aberto;
- [ ] background/foreground do PWA após conexão não quebra controles já suportados;
- [ ] timeout/abort não deixa polling, popup ou sessão órfãos.

Se o iOS suspender uma das páginas de forma que impossibilite a sinalização, o desenho precisa ser revisto antes de declarar suporte.

### 8. Testes automatizados — Web

Aplicar TDD nas mudanças de comportamento.

A cobertura unitária do contrato está em `apps/web/src/tv-lan-bridge-protocol.test.ts`. O relay real existe no runtime da BTV, mas seus testes dedicados e a integração PWA continuam abertos.

Cobrir no mínimo:

- [ ] handshake bridge `ready`/channel binding;
- [x] `event.source` incorreto é ignorado;
- [x] `event.origin` incorreto é ignorado;
- [x] nonce/channel incorreto é ignorado;
- [x] request/response correlacionados por ID;
- [ ] timeout;
- [ ] popup bloqueado;
- [ ] fechamento/abort durante request;
- [x] response tardia de tentativa anterior;
- [x] bridge não aceita operação fora da allowlist;
- [ ] challenge via bridge;
- [ ] join via bridge com proof calculada no PWA;
- [ ] `signals` POST via bridge com autorização assinada;
- [ ] `signals` GET/poll via bridge;
- [ ] `close` best-effort via bridge;
- [ ] QR expirado/regenerado;
- [x] resposta inválida/malformada;
- [ ] caminho direto continua funcionando;
- [ ] nenhum segredo é incluído nas mensagens do bridge além do estritamente necessário ao protocolo de request já autenticado;
- [ ] cleanup remove listeners/timers/window refs.

### 9. Testes automatizados — Android TV

- [ ] testar roteamento de `/bridge` e `/bridge.js`;
- [ ] validar que os assets estão empacotados no APK;
- [ ] validar MIME/content-type dos assets;
- [ ] cobrir requests permitidas pelo relay sem abrir proxy genérico;
- [ ] validar limites de payload;
- [ ] validar erro/timeout sem derrubar o listener LAN;
- [ ] manter testes existentes de sessão, TTL, replay e autenticação;
- [ ] manter receiver `/receiver/*` restrito a loopback.

### 10. E2E/CI

- [ ] adaptar/criar fixture de bridge para browser test quando aplicável;
- [ ] exercitar `challenge → join → signals → DataChannel` usando o transporte bridge;
- [ ] comprovar que o payload de mídia continua no DataChannel, não no bridge;
- [ ] manter E2E do transporte LAN direto;
- [ ] manter regressão do modo TV online;
- [ ] manter E2E offline total existente;
- [ ] executar `npm run check` ou CI equivalente no mesmo head final;
- [ ] security regression gate no mesmo head final;
- [ ] Android TV build + lint + testes no mesmo head final;
- [ ] verificação de assets do receiver/bridge no APK;
- [ ] revisar o diff completo contra `main` no head final.

### 11. QA físico obrigatório — iPhone + BTV 11

Pré-condições:

- APK deste PR instalado na BTV 11;
- Home Music/PWA já disponível no iPhone;
- pelo menos duas faixas já baixadas;
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
- [ ] testar pause/play;
- [ ] testar seek;
- [ ] testar next/previous;
- [ ] reproduzir faixa B;
- [ ] background/foreground do Home Music;
- [ ] regenerar QR e confirmar invalidação da sessão anterior;
- [ ] encerrar receiver e confirmar cleanup;
- [ ] religar WAN/backend e confirmar que modo online continua íntegro.

Registrar:

- modelo do iPhone;
- versão do iOS;
- Safari/Chrome e versão usada;
- firmware/Android da BTV;
- GeckoView do APK;
- comportamento de popup/aba bridge;
- latência aproximada de pareamento;
- resultado dos controles e playback;
- qualquer erro reproduzível.

### 12. Testes físicos negativos

- [ ] TV fora da LAN/inalcançável;
- [ ] popup bloqueado;
- [ ] QR expirado;
- [ ] QR regenerado durante conexão;
- [ ] fechar bridge antes do join;
- [ ] fechar bridge durante polling de sinalização;
- [ ] fechar receiver durante conexão;
- [ ] desligar Wi-Fi durante sinalização;
- [ ] desligar Wi-Fi durante transferência de mídia;
- [ ] AP/client isolation;
- [ ] sessão expirada após estabelecida;
- [ ] tentar reutilizar mensagem/autorização já consumida quando aplicável.

### 13. Documentação de produção

Depois que o comportamento estiver validado:

- [ ] atualizar `docs/tv-offline-lan-protocol.md` com o bridge como adaptação de transporte, sem alterar a semântica v2;
- [ ] atualizar `docs/tv-offline-cast.md`;
- [ ] atualizar `docs/tv-remote-control.md`;
- [ ] atualizar `docs/android-tv.md`;
- [ ] atualizar `android-tv/README.md`;
- [ ] atualizar `e2e/README.md` se houver novo cenário/gate;
- [ ] registrar matriz real de compatibilidade para iOS;
- [ ] deixar explícito que leitura automática de QR no Safari/iOS pode continuar usando fallback manual, se esse continuar sendo o comportamento validado;
- [ ] registrar limitações de popup/lifecycle e AP/client isolation;
- [ ] registrar procedimento físico reproduzível.

### 14. Limpeza antes do merge

- [ ] remover `docs/spikes/ios-lan-bridge-probe.html` se ele não tiver mais valor diagnóstico;
- [ ] remover mensagens/botões exclusivamente de spike;
- [ ] remover código morto e listeners/timers temporários;
- [ ] confirmar que não há logs de secret/token/Authorization;
- [ ] confirmar que bridge não expõe fetch/proxy arbitrário;
- [ ] confirmar que não existe duplicação da lógica v2;
- [ ] atualizar descrição do PR com testes realmente executados;
- [ ] manter o PR draft enquanto faltar QA físico ou gate bloqueante;
- [ ] só marcar ready/merge após revisão do diff e gates no head final.

## Critérios de aceite desta evolução

A evolução do PR só pode ser considerada pronta quando todos estes pontos forem verdadeiros:

- [ ] iPhone real completa pareamento sem `fetch()` HTTPS → HTTP direto;
- [ ] `challenge`, `join`, `signals` e `close` passam pelo bridge com as mesmas regras do protocolo v2;
- [ ] secret do QR e derivação HMAC permanecem no PWA;
- [ ] WebRTC/DataChannel continua sendo o transporte P2P;
- [ ] duas faixas offline tocam na BTV com WAN e servidor Home Music desligados;
- [ ] controles essenciais funcionam;
- [ ] sessão expirada/regenerada não é reutilizável;
- [ ] bridge/polling/listeners/timers são limpos ao encerrar;
- [ ] caminho direto Android/Chrome continua verde;
- [ ] modo online continua verde;
- [ ] CI completo aplicável está verde no mesmo head final;
- [ ] QA físico do iPhone/BTV está registrado;
- [ ] documentação e matriz de compatibilidade refletem somente o que foi realmente validado.

## Fora de escopo

- transformar o bridge em servidor de mídia;
- enviar áudio pelo `postMessage`;
- substituir WebRTC/DataChannel;
- alterar o protocolo LAN v2 sem necessidade demonstrada;
- criar proxy HTTP genérico para a rede local;
- redes diferentes/NAT/remoto;
- mDNS/discovery automático;
- instalação inicial do PWA sem internet;
- download de novas músicas com backend indisponível;
- afirmar suporte a browser/hardware que não foi testado fisicamente;
- adicionar dependência nova de scanner QR no iOS apenas para eliminar o fallback manual.
