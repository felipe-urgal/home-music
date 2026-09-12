# Home Music TV / Android TV

O Home Music possui um cliente Android TV em `android-tv/` para abrir a aplicação web em tela cheia em TVs e boxes Android. O alvo inicial de validação é o **BTV 11**, mas o projeto mantém compatibilidade geral com Android 6/API 23 ou superior quando o firmware oferece os recursos básicos necessários.

O cliente Android não replica backend, biblioteca ou autenticação. Ele abre o frontend existente e ativa um **modo TV** dedicado, mantendo o servidor Home Music como autoridade única para sessão, biblioteca, player e dados pessoais.

## Estado atual

A implementação está no PR #391 e a validação em hardware real é acompanhada pela issue #392.

Já foi confirmado em BTV 11 real que:

- o APK pode ser instalado após os ajustes de compatibilidade do package installer;
- o app abre o servidor Home Music em tela cheia;
- o WebView original do aparelho não é suficiente para o frontend atual, então o APK embarca GeckoView;
- a UI desktop não é adequada à TV, então o frontend possui um modo TV separado.

A versão de teste atual é `0.4.0` (`versionCode 5`).

## Arquitetura

```text
BTV / Android TV
      |
      v
Home Music TV APK
  - Activity Android
  - GeckoView embarcado
  - URL do servidor persistida localmente
      |
      | abre com ?tv=1
      v
Frontend Home Music
  - login adaptado para TV
  - layout 16:9 dedicado
  - D-pad / OK / foco espacial
  - biblioteca e player existentes
      |
      v
Servidor Home Music / SQLite / MUSIC_DIR
```

O projeto Android fica fora dos workspaces npm. O CI web continua independente de Gradle/Android SDK e existe um workflow separado em `.github/workflows/android-tv.yml`.

## URL do servidor

Na primeira configuração, o campo vem pré-preenchido com:

```text
https://home-music.tail6ab100.ts.net/
```

O usuário ainda pode trocar por outro endereço `https://` ou `http://`. A escolha é salva em `SharedPreferences` somente no aparelho.

Ao abrir o site, o APK acrescenta `tv=1`. O frontend guarda o modo TV na sessão para preservar a experiência durante navegação interna sem mudar o comportamento normal de desktop, celular ou PWA.

## Interface TV

O modo TV não tenta apenas reduzir o layout desktop. Ele possui composição própria para uso a distância e em 16:9.

Superfícies principais:

- Home;
- Pastas;
- Álbuns;
- Artistas;
- Músicas;
- Busca;
- Playlists;
- player inferior persistente;
- Minha conta como entrada utilitária.

A navegação principal usa D-pad/OK com foco visível e scroll automático para elementos que entram em foco. A tela de login e superfícies utilitárias também recebem navegação por teclado/controle quando o modo TV está ativo.

## Login

O login continua usando a autenticação web normal do Home Music. O APK não recebe, armazena ou conhece a senha do usuário por uma bridge nativa.

No modo TV:

- o card é redimensionado para 16:9;
- campos e botão possuem alvos maiores e foco visível;
- D-pad vertical percorre campos e ações;
- OK/Enter ativa o item focado;
- a digitação usa o teclado fornecido pelo Android/BTV.

Depois do login, cookies e storage do GeckoView preservam a sessão no armazenamento privado do aplicativo.

## Compatibilidade com BTV 11

Durante os testes reais foram encontrados três problemas importantes.

### Package installer

O primeiro APK retornava **“ocorreu um problema ao analisar o pacote”**. Para ampliar compatibilidade:

- `minSdk` foi reduzido para 23;
- assinatura debug/release usa v1 + v2;
- v3/v4 ficam desabilitadas nesta distribuição de compatibilidade;
- o app evita depender de APIs modernas sem fallback.

### Tela preta

O WebView do firmware do BTV abriu o frontend com tela preta. A solução atual é embarcar:

```text
org.mozilla.geckoview:geckoview:126.0.20240526221752
```

Isso aumenta bastante o tamanho do APK, mas remove a versão do WebView do BTV da cadeia crítica de renderização.

### Launcher

O manifest declara as duas entradas:

```text
android.intent.category.LAUNCHER
android.intent.category.LEANBACK_LAUNCHER
```

O app também possui ícone `android:icon`, `android:roundIcon` e banner próprio do Home Music.

A opção **Adicionar à tela inicial** usa `ShortcutManager.requestPinShortcut()` quando o launcher expõe a API padrão. Launchers customizados, como o do BTV, podem ignorar ou não oferecer essa capacidade; nesse caso o app informa a limitação e continua disponível na lista de aplicativos.

## Controles

- **D-pad**: move o foco na interface TV;
- **OK / Enter**: ativa o item focado;
- **Voltar**: usa histórico quando disponível; na raiz oferece alterar endereço, adicionar à tela inicial ou sair;
- **Menu / Settings**: abre a configuração de endereço quando o controle expõe uma dessas teclas.

A tela permanece ativa enquanto a Activity está aberta.

## Build e CI

Requisitos locais:

- JDK 17;
- Android SDK 35;
- Gradle 8.10.2.

Build:

```bash
gradle -p android-tv :app:assembleDebug
```

APK:

```text
android-tv/app/build/outputs/apk/debug/app-debug.apk
```

O workflow **Android TV** executa `assembleDebug` e `lintDebug` e publica `home-music-tv-debug-apk` como artifact. O workflow é acionado apenas por mudanças em `android-tv/**`, no próprio workflow ou manualmente.

## Instalação de teste no BTV

1. baixe o artifact mais recente do workflow Android TV;
2. extraia `app-debug.apk` caso esteja dentro de ZIP;
3. copie o APK para um pendrive ou baixe diretamente no aparelho;
4. no BTV, permita instalação por fonte desconhecida para o gerenciador/Downloader usado;
5. instale o APK;
6. abra **Home Music TV** pela lista de aplicativos;
7. confirme ou altere a URL pré-preenchida;
8. faça login e valide a navegação usando somente o controle remoto.

Se a assinatura do build de teste não for compatível com uma instalação anterior, desinstale a versão antiga e instale novamente. Isso remove os dados locais do APK e exige configurar a URL/login outra vez.

## Assinatura release

O APK de debug é apenas para sideload e validação. Atualizações estáveis precisam ser assinadas sempre com a mesma chave privada.

O build aceita:

```text
ANDROID_TV_KEYSTORE_PATH
ANDROID_TV_KEYSTORE_PASSWORD
ANDROID_TV_KEY_ALIAS
ANDROID_TV_KEY_PASSWORD
```

O keystore não deve ser commitado. Ele precisa de backup seguro porque perder a chave impede atualizações instaláveis por cima do mesmo application id.

## Segurança

- não existe bridge JavaScript nativa exposta ao frontend;
- autenticação e autorização continuam no backend Home Music;
- a URL é persistida apenas no storage privado do app;
- HTTPS é preferido; HTTP continua permitido para instalações locais controladas;
- erros TLS não devem ser ignorados para “fazer funcionar” um servidor com certificado inválido.

## Limitações e próximos passos

A validação final é feita no hardware real e está registrada na issue #392. Os pontos principais são navegação por D-pad, escala/overscan em 1080p, player, login, persistência de sessão, comportamento do launcher e estratégia de distribuição de um APK release assinado.
