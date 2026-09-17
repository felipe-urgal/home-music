# Home Music TV

Cliente Android para abrir o Home Music em tela cheia em Android TV/boxes, com foco inicial no BTV 11.

A documentação funcional e de compatibilidade fica em [`../docs/android-tv.md`](../docs/android-tv.md). Este arquivo mantém apenas o contrato de implementação/build do módulo `android-tv/`.

## Estado atual

- versão de teste: `0.4.0` (`versionCode 5`);
- `applicationId`: `com.homemusic.tv`;
- `minSdk 23`, `targetSdk 35`, `compileSdk 35`;
- GeckoView embarcado para não depender do Android System WebView do aparelho;
- assinatura de compatibilidade v1 + v2 nos builds debug e release assinados;
- launcher comum + `LEANBACK_LAUNCHER`;
- ícone, `roundIcon` e banner próprios do Home Music;
- opção nativa **Adicionar à tela inicial** quando o launcher suporta pin shortcut;
- URL padrão `https://home-music.tail6ab100.ts.net/` pré-preenchida e persistida em `SharedPreferences`;
- o servidor é carregado com `?tv=1`, ativando a experiência dedicada para TV no frontend;
- serviço LAN efêmero com QR/challenge/join e signaling autenticado por `home-music-lan-remote-v2`;
- receiver offline web empacotado no APK e servido somente por loopback;
- `join` LAN autenticado solicita abertura automática do receiver offline; o atalho manual permanece como fallback;
- `bridge.html` + `bridge.js` empacotados para adaptar signaling no iPhone/iPad sem transportar áudio nem receber o segredo do QR.

## Build local

Requisitos:

- JDK 17;
- Android SDK 35;
- Gradle 8.10.2.

```bash
npm run build -w @home-music/shared
npm run build:tv-receiver -w @home-music/web
gradle -p android-tv :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
```

APK:

```text
android-tv/app/build/outputs/apk/debug/app-debug.apk
```

O workflow `.github/workflows/android-tv.yml` executa esses gates, confere `tv-offline-receiver.html` e bundles dentro do APK, valida `bridge.html`/`bridge.js` e publica `home-music-tv-debug-apk`.

## Runtime offline

O módulo Android separa responsabilidades:

- `LanPairingServer`: listener/endpoints LAN, CORS/limites e assets locais;
- `LanPairingSession`: challenge, TTL, HMAC, replay protection e mailbox de signaling;
- `LanAddressResolver`: endereço LAN utilizável;
- `MainActivity`: coordena lifecycle do pareamento e abertura do receiver.

O serviço LAN não transporta mídia. Depois do signaling, áudio, comandos e estado trafegam pelo WebRTC/DataChannel entre PWA e receiver.

Quando um `join` remoto é aceito, a sessão notifica a Activity exatamente uma vez para abrir o receiver. Replay do mesmo join continua inválido e não deve causar nova abertura.

## Bridge iOS

`src/main/assets/bridge.html` e `bridge.js` implementam uma superfície HTTP local restrita para iPhone/iPad:

- aberta por navegação top-level;
- comunicação com o PWA por `postMessage`;
- operações limitadas a challenge/join/signaling/complete/close;
- sem proxy HTTP arbitrário;
- sem `secret` do QR no bridge;
- sem transporte de mídia;
- tentativa de fechamento da janela após o DataChannel ficar pronto, com fallback manual quando o browser impedir `window.close()`.

Android/desktop continuam usando o transporte LAN direto quando suportado.

## Instalação de teste

1. baixe o artifact do workflow **Android TV**;
2. extraia `app-debug.apk`;
3. transfira para o BTV por pendrive/Downloader;
4. permita instalação de apps desconhecidos para a origem usada;
5. instale e abra **Home Music TV**;
6. confirme a URL e teste o modo online ou offline desejado.

O APK de debug é para validação. Se um build não instalar por cima de outro por diferença de assinatura de teste, desinstale a versão anterior e faça uma instalação limpa.

## Assinatura release

Atualizações estáveis precisam usar sempre o mesmo keystore. O build aceita:

```text
ANDROID_TV_KEYSTORE_PATH
ANDROID_TV_KEYSTORE_PASSWORD
ANDROID_TV_KEY_ALIAS
ANDROID_TV_KEY_PASSWORD
```

A chave privada não deve ser commitada. Preserve um backup seguro do keystore usado na distribuição.

## Isolamento

`android-tv/` fica fora dos workspaces npm. Alterações normais no servidor, PWA e frontend não dependem do Gradle/Android SDK, exceto quando o bundle/contrato do receiver offline faz parte da mudança e precisa ser empacotado no APK.

A validação automatizada não substitui o BTV 11. Para offline total, testar com WAN e servidor desligados, duas faixas já baixadas, abertura automática do receiver, comandos P2P, background/lock, regeneração/expiração do QR, perda real de Wi-Fi, mudança de IP e recuperação online. Registrar versões e evidências nas issues #417/#422.
