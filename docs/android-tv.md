# Home Music TV / Android TV

O Home Music possui um cliente Android TV em `android-tv/` para abrir a aplicação web em tela cheia em TVs e boxes Android. O alvo inicial é o **BTV 11**; o módulo mantém `minSdk 23` e usa GeckoView embarcado para não depender do WebView antigo/customizado do aparelho.

No modo online, o APK abre o frontend existente com `?tv=1`. No modo offline local, ele inicia um serviço HTTP efêmero, exibe o QR de pareamento e disponibiliza um receiver web embarcado por loopback. Conta, biblioteca e credenciais Home Music não são copiadas para o APK.

## Estado atual

A base de TV inclui:

- experiência web dedicada ativada por `?tv=1`;
- navegação por D-pad/OK, player canônico e layout 16:9;
- controle remoto online pelo celular usando sessão REST/SSE autenticada;
- envio P2P de faixa baixada do celular para a TV por WebRTC/DataChannel;
- modo totalmente offline na LAN, sem backend/WAN durante a sessão;
- serviço LAN efêmero com protocolo `home-music-lan-remote-v2`;
- receiver offline web empacotado no APK;
- bridge HTTP local para iPhone/iPad, usada somente para adaptar signaling quando o browser não permite o `fetch()` HTTPS → HTTP privado do transporte direto.

Os componentes principais do modo LAN foram incorporados pelos PRs #423 e #427. O PR #430 acrescentou dois comportamentos importantes do fluxo físico iPhone + BTV:

- após um `join` LAN autenticado, o APK abre o receiver offline automaticamente; **Abrir receiver offline** continua disponível apenas como fallback manual;
- `RTCPeerConnection.connectionState = disconnected` é tratado como transitório e recuperável. A sessão não é destruída apenas por esse estado; `failed`, `closed` e fechamento/erro real do DataChannel continuam terminais.

Isso não equivale a declarar o hardware totalmente homologado. As issues #417 e #422 continuam abertas para registrar a matriz física final e cenários negativos.

## Modo offline local

O APK empacota `tv-offline-receiver.html` e assets versionados gerados por:

```bash
npm run build:tv-receiver -w @home-music/web
```

O listener LAN fornece somente bootstrap, challenge/join e sinalização. O áudio não passa pelo HTTP local: músicas já baixadas no PWA são enviadas pelo DataChannel.

Pré-condições gerais:

- PWA já instalado/cached no celular;
- faixas já armazenadas localmente;
- celular e TV na mesma LAN;
- rede sem AP/client isolation;
- browser com um transporte LAN suportado para aquela plataforma.

Android/desktop usam o transporte HTTP LAN direto quando a plataforma permite. iPhone/iPad usam o bridge local top-level + `postMessage`; segredo do QR, proof e HMAC continuam no PWA, e a mídia continua no WebRTC/DataChannel.

QR, challenge e sessão são efêmeros. Regenerar o pareamento invalida material anterior conforme o protocolo v2.

### Lifecycle do receiver

Ao iniciar um pareamento offline, a TV mantém o receiver local disponível por loopback. Depois que o celular conclui um `join` autenticado, o APK solicita a abertura automática do receiver uma única vez para aquela entrada válida. Isso evita depender de um clique adicional no controle remoto.

O botão/atalho manual para abrir o receiver permanece como recuperação explícita. Replays do mesmo `join` não devem iniciar o receiver novamente.

### Lifecycle do peer

Depois de aberto o DataChannel:

- `connected` + canal aberto corresponde ao estado utilizável;
- `disconnected` muda a UI para reconectando/conectando, mas não fecha o peer por timeout arbitrário;
- se o WebRTC voltar a `connected`, a sessão pode retornar a `open` sem novo QR;
- `failed`, `closed`, erro do DataChannel ou fechamento inesperado real continuam encerrando a tentativa;
- quando a sessão realmente termina, um novo pareamento/QR é o caminho seguro; sessão expirada/regenerada não é reutilizada.

Esse comportamento é especialmente importante para background/lock em mobile, onde `disconnected` pode ser temporário.

## Roteiro físico reproduzível

Usar APK e PWA correspondentes ao mesmo estado de código:

1. instalar o APK e abrir o modo offline;
2. desligar WAN e servidor Home Music, mantendo a LAN;
3. abrir o PWA em cold start e confirmar ao menos duas faixas baixadas;
4. gerar QR e parear sem clicar em **Abrir receiver offline**;
5. confirmar que o receiver abre automaticamente após o `join` autenticado;
6. tocar duas faixas e exercer play/pause/seek/anterior/próxima;
7. colocar o celular em background/lock e voltar;
8. confirmar que um `disconnected` transitório não destrói a sessão e que os controles retornam quando o peer se recupera;
9. regenerar o QR e confirmar que a sessão anterior não reconecta;
10. testar perda real de rede e confirmar que falha terminal exige novo pareamento;
11. repetir negativos de permissão/bridge bloqueado, outra Wi-Fi/client isolation, receiver fechado, IP alterado, arquivo ausente/corrompido e faixa acima do limite;
12. religar WAN/servidor e confirmar o modo online.

Registrar modelo/versão do celular, browser/PWA, BTV/Android, GeckoView, commit/APK e resultado dos cenários. O CI não autoriza declarar hardware validado.

## Arquitetura

```text
Modo online
Celular/Browser ── HTTPS ──> Home Music/Fastify <── HTTPS ── GeckoView/BTV
                     │                 │
                     └── signaling ────┘
                           WebRTC P2P para mídia quando aplicável

Modo LAN offline
PWA no celular ── signaling LAN ──> serviço efêmero no APK
      │                                  │
      └──────── WebRTC/DataChannel ──────┘
                         │
                         v
             receiver web por loopback
```

No iOS, o bloco de signaling LAN é adaptado pela página local `/bridge`; a página não transporta áudio nem recebe o segredo do QR.

O projeto Android fica fora dos workspaces npm. O workflow próprio é `.github/workflows/android-tv.yml`.

## URL do servidor

Na primeira configuração, o campo vem pré-preenchido com:

```text
https://home-music.tail6ab100.ts.net/
```

O usuário pode trocar por outro endereço `https://` ou `http://`. A escolha fica em `SharedPreferences` no aparelho. Ao abrir o site, o APK acrescenta `tv=1`.

## Interface TV

A sidebar principal contém:

- **Início**;
- **Biblioteca**;
- **Buscar**;
- **Playlists**.

Biblioteca agrupa **Pastas**, **Álbuns**, **Artistas** e **Músicas** como abas grandes. **Minha conta** fica no topo.

### Navegação por D-pad

A tela principal trabalha com três zonas:

```text
Sidebar  <->  Conteúdo
                 |
                 v
              Player
```

- ↑/↓ na sidebar percorrem os destinos;
- → entra no conteúdo;
- ← no limite esquerdo retorna à sidebar;
- ↓ no limite inferior entra no player;
- ↑ no player retorna ao conteúdo;
- OK/Enter ativa o item focado;
- foco visível e scroll acompanham a navegação.

Login, telas utilitárias e Minha conta também recebem navegação auxiliar por D-pad.

## Player para TV

No player inferior:

- anterior, play/pause e próxima são ações diretas;
- progresso é focável; ←/→ fazem seek de **10 s**;
- quando o Home Music controla volume internamente, ←/→ mudam **10%**;
- quando o volume é do sistema, a UI indica **Volume da TV**.

Desktop/mobile mantêm o seletor completo de crossfade. No modo TV, Minha conta oferece os presets:

```text
Desligado | 10 s | 20 s | 30 s
```

Durante a transição, capa, título e artista acompanham o progresso do crossfade de áudio.

## Controle online pelo celular

No modo online, **Controle pelo celular** cria uma sessão remota efêmera no servidor e mostra QR/URL de pareamento. O celular precisa estar autenticado na mesma conta.

A superfície remota não cria player local. Ela controla o player canônico da TV e suporta play/pause, anterior/próxima, seleção de faixa e os controles compartilhados expostos pela UI atual. Sinalização WebRTC pode usar a mesma sessão para enviar uma faixa já baixada diretamente pelo DataChannel.

Arquitetura e segurança: [`tv-remote-control.md`](tv-remote-control.md). Envio P2P e modo LAN: [`tv-offline-cast.md`](tv-offline-cast.md) e [`tv-offline-lan-protocol.md`](tv-offline-lan-protocol.md).

## Login

Hoje o login da TV usa a autenticação web normal. O APK não recebe nem armazena senha por bridge nativa; cookies/storage do GeckoView preservam a sessão no armazenamento privado do app.

A evolução de produto para **login da TV pelo celular via QR** é acompanhada pela issue #428. Enquanto ela não for implementada, usuário/senha no frontend continua sendo o fluxo de autenticação da TV.

## Compatibilidade com BTV 11

### Package installer

Para evitar o erro de análise de pacote encontrado nos primeiros builds:

- `minSdk 23`;
- assinatura v1 + v2;
- v3/v4 desabilitadas nessa distribuição de compatibilidade;
- APIs modernas evitadas quando não há fallback.

### GeckoView

O WebView do firmware produziu tela preta. O APK embarca:

```text
org.mozilla.geckoview:geckoview:126.0.20240526221752
```

Isso aumenta o APK, mas remove o WebView do BTV da cadeia crítica.

### Launcher

O manifest declara `LAUNCHER` e `LEANBACK_LAUNCHER`, além de ícone/roundIcon/banner. **Adicionar à tela inicial** usa `ShortcutManager.requestPinShortcut()` quando disponível; launchers customizados podem ignorar a API.

## Controles Android

- D-pad: navega no frontend;
- OK/Enter: ativa o foco;
- Voltar: usa histórico; na raiz oferece configurar URL, pin ou sair;
- Menu/Settings: abre configuração de endereço quando a tecla existe.

A tela permanece ativa enquanto a Activity estiver aberta.

## Build e CI

Requisitos: JDK 17, Android SDK 35, Gradle 8.10.2.

```bash
npm run build -w @home-music/shared
npm run build:tv-receiver -w @home-music/web
gradle -p android-tv :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

APK:

```text
android-tv/app/build/outputs/apk/debug/app-debug.apk
```

A versão de teste atual é `0.4.0` (`versionCode 5`).

O workflow **Android TV** gera o receiver, executa testes JVM, build/lint, verifica os assets do receiver e do bridge dentro do APK e publica `home-music-tv-debug-apk`.

O CI web mantém gates específicos para controle remoto, offline cast, LAN totalmente offline e bridge iOS, além dos gates gerais descritos em [`testing-and-quality.md`](testing-and-quality.md).

## Instalação de teste

1. baixe o artifact do workflow **Android TV**;
2. extraia `app-debug.apk`;
3. transfira para o aparelho;
4. permita instalação de apps desconhecidos para a origem usada;
5. instale e abra **Home Music TV**;
6. confirme a URL e valide o modo desejado.

Builds de teste com assinatura incompatível podem exigir reinstalação limpa, removendo URL/login locais.

## Assinatura release

O APK debug é para sideload/validação. Releases atualizáveis precisam da mesma chave privada:

```text
ANDROID_TV_KEYSTORE_PATH
ANDROID_TV_KEYSTORE_PASSWORD
ANDROID_TV_KEY_ALIAS
ANDROID_TV_KEY_PASSWORD
```

O keystore não deve ser commitado e precisa de backup seguro.

## Segurança

- nenhuma bridge JavaScript nativa genérica é exposta;
- autenticação/autorização online permanecem no backend;
- o protocolo LAN usa sessão curta, segredo de alta entropia, challenge/HMAC, TTL e proteção contra replay;
- a bridge iOS é uma allowlist de operações de signaling, não um proxy HTTP arbitrário;
- segredo do QR e derivação HMAC permanecem no PWA;
- mídia e comandos após o pareamento usam WebRTC/DataChannel;
- URL configurada fica no storage privado do app;
- HTTPS é preferido para o servidor Home Music; HTTP permanece para instalações locais controladas;
- erros TLS não são ignorados.

## Validação restante

A implementação automatizada do modo offline LAN está na `main`, mas a homologação física final continua nas issues #417 e #422. Já houve QA físico em iPhone + BTV confirmando o caminho principal até WebRTC/DataChannel e reprodução; as rodadas seguintes motivaram os hardenings dos PRs #427 e #430.

Ainda devem ser registrados de forma reproduzível, no head/APK final usado para homologação:

- cold start completo com WAN/backend desligados;
- matriz real de browser/iOS/Android/BTV/GeckoView;
- background/lock/foreground por tempo prolongado;
- perda real de Wi-Fi versus `disconnected` transitório;
- QR expirado/regenerado e cleanup;
- AP/client isolation e redes bloqueadas;
- comportamento de popup/fechamento do bridge iOS;
- recuperação do modo online após religar backend/WAN.

Não declarar suporte físico completo além da evidência registrada nessas issues.
