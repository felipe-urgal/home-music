# Home Music TV

Cliente Android TV mínimo para abrir o Home Music em tela cheia a partir do launcher da TV/box.

O projeto fica isolado em `android-tv/`: ele não entra nos workspaces npm e não altera o servidor, o PWA ou o cliente web existentes.

## Como funciona

1. Instale o APK no Android TV/box.
2. Abra **Home Music** pelo ícone do launcher.
3. Na primeira execução, informe a URL do seu Home Music (`https://...` ou `http://...`).
4. A URL fica salva somente no aparelho e as próximas aberturas entram direto no site.
5. Cookies, `localStorage` e a sessão web ficam no armazenamento privado do WebView do aplicativo.

O app usa `WebView` do próprio Android. As atualizações normais do Home Music web aparecem automaticamente, sem gerar um APK novo.

## Controles da TV

- D-pad/OK: navegação normal pelo Home Music e pelo teclado do sistema.
- Voltar: volta no histórico do site. Na raiz, abre opções para alterar o endereço ou sair.
- Menu/Settings do controle: abre a tela para alterar o endereço do servidor, quando o controle expõe uma dessas teclas.
- A tela permanece ativa enquanto o app estiver aberto, evitando suspensão durante reprodução.

## BTV 11

O `minSdk` é 28 (Android 9), compatível com a versão de Android usada pelo BTV 11.

Para instalar:

1. baixe o APK gerado pelo workflow **Android TV** do GitHub Actions;
2. transfira para o BTV via Downloader ou pendrive;
3. permita **Instalar apps desconhecidos** para o Downloader/gerenciador de arquivos quando o Android solicitar;
4. abra o APK e escolha **Instalar**;
5. procure **Home Music** na lista/tela inicial de aplicativos.

O launcher é declarado tanto como `LAUNCHER` quanto `LEANBACK_LAUNCHER` para funcionar em Android TV e em launchers de boxes Android que não implementam Leanback completamente.

## Build local

Requisitos: JDK 17, Android SDK 35 e Gradle 8.10.2.

```bash
gradle -p android-tv :app:assembleDebug
```

APK:

```text
android-tv/app/build/outputs/apk/debug/app-debug.apk
```

## Assinatura para atualizações

O APK de debug serve para teste/sideload. Para distribuir atualizações que instalem **por cima** da versão anterior mantendo dados e login, use sempre a mesma chave privada de assinatura.

O `app/build.gradle` aceita estas variáveis para um build release assinado:

```text
ANDROID_TV_KEYSTORE_PATH
ANDROID_TV_KEYSTORE_PASSWORD
ANDROID_TV_KEY_ALIAS
ANDROID_TV_KEY_PASSWORD
```

A chave privada não deve ser commitada no repositório. Quando formos publicar uma versão estável para o BTV, configure esses valores como secrets do GitHub Actions (ou assine localmente) e preserve o keystore em backup seguro.

## Segurança

- JavaScript e DOM storage ficam habilitados porque o Home Music depende deles.
- acesso direto a arquivos e `content://` pelo WebView fica desabilitado;
- Safe Browsing fica habilitado;
- links `http://` são permitidos para instalações locais, mas HTTPS é recomendado sempre que disponível;
- nenhum bridge JavaScript nativo é exposto ao conteúdo web.

## Limitação importante do BTV

A compatibilidade final com o frontend depende da versão do **Android System WebView** instalada no BTV. Se o aparelho estiver com WebView muito antigo, pode ser necessário atualizar o componente pelo sistema/loja do aparelho antes de usar o Home Music TV.
