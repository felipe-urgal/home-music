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
- o servidor é carregado com `?tv=1`, ativando a experiência dedicada para TV no frontend.

## Build local

Requisitos:

- JDK 17;
- Android SDK 35;
- Gradle 8.10.2.

```bash
gradle -p android-tv :app:assembleDebug
```

APK:

```text
android-tv/app/build/outputs/apk/debug/app-debug.apk
```

O workflow `.github/workflows/android-tv.yml` executa o mesmo build mais `lintDebug` e publica o APK como artifact `home-music-tv-debug-apk`.

## Instalação de teste

1. baixe o artifact do workflow **Android TV**;
2. extraia `app-debug.apk`;
3. transfira para o BTV por pendrive/Downloader;
4. permita instalação de apps desconhecidos para a origem usada;
5. instale e abra **Home Music TV**;
6. confirme a URL pré-preenchida e faça login.

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

`android-tv/` fica fora dos workspaces npm. Alterações normais no servidor, PWA e frontend não dependem do Gradle/Android SDK.

A validação no BTV 11 e os itens restantes estão na issue #392.
