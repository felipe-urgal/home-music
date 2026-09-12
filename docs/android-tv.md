# Home Music TV / Android TV

O Home Music possui um cliente Android TV em `android-tv/` para abrir a aplicação web em tela cheia em TVs e boxes Android. O alvo inicial de validação é o **BTV 11**, mas o projeto mantém compatibilidade geral com Android 6/API 23 ou superior quando o firmware oferece os recursos básicos necessários.

O cliente Android não replica backend, biblioteca ou autenticação. Ele abre o frontend existente e ativa um **modo TV** dedicado, mantendo o servidor Home Music como autoridade única para sessão, biblioteca, player e dados pessoais.

## Estado atual

O cliente Android e o primeiro modo TV foram incorporados pelo PR #391. A validação em hardware real e os refinamentos continuam acompanhados pela issue #392.

Já foi confirmado em um BTV 11 real que:

- o APK pode ser instalado após os ajustes de compatibilidade do package installer;
- o app abre o servidor Home Music em tela cheia;
- o WebView original do aparelho não é suficiente para o frontend atual, então o APK embarca GeckoView;
- o modo `?tv=1` é reconhecido depois do deploy do frontend e melhora a composição em relação ao desktop;
- a primeira iteração ainda tinha navegação irregular, sidebar excessiva, progresso difícil de operar e `select` de crossfade inadequado ao controle remoto.

A versão de APK de teste continua `0.4.0` (`versionCode 5`). Os ajustes de TV v2 são de frontend e, portanto, não exigem reinstalar o APK depois do deploy.

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
  - navegação por zonas de foco
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

## Interface TV v2

O modo TV possui composição própria para uso a distância e em 16:9. A segunda iteração reduz a quantidade de destinos simultâneos e prioriza previsibilidade com o controle remoto.

A sidebar principal contém somente:

- **Início**;
- **Biblioteca**;
- **Buscar**;
- **Playlists**.

A tela **Biblioteca** agrupa **Pastas**, **Álbuns**, **Artistas** e **Músicas** como abas grandes dentro da própria área de conteúdo. **Minha conta** fica no topo em vez de ocupar um destino da sidebar.

A Home também foi simplificada: mostra Pastas e Álbuns em destaque e deixa listas longas para Biblioteca. Isso reduz saltos de foco e a quantidade de elementos simultâneos na tela.

## Navegação por controle remoto

A navegação da tela principal é dividida em três zonas explícitas:

```text
Sidebar  <->  Conteúdo
                 |
                 v
              Player
```

Regras principais:

- ↑/↓ na sidebar percorrem somente seus quatro destinos;
- → sai da sidebar e entra no conteúdo;
- ← no limite esquerdo do conteúdo retorna à sidebar ativa;
- ↑/↓ e ←/→ dentro do conteúdo procuram somente elementos daquela zona;
- ↓ no limite inferior do conteúdo entra no player;
- ↑ no player retorna ao último elemento de conteúdo usado;
- OK/Enter ativa o controle focado;
- o foco continua visualmente destacado e itens de conteúdo fazem scroll para a área visível.

Telas utilitárias, login e Minha conta continuam usando a navegação auxiliar por D-pad quando o modo TV está ativo.

## Player para TV

Sliders HTML pequenos não são tratados como interação principal na TV.

No player inferior:

- anterior, play/pause e próxima continuam ações diretas;
- o progresso é um controle focável e visual;
- com o progresso focado, ← retrocede **10 s** e → avança **10 s**;
- quando o Home Music controla o volume internamente, ←/→ ajustam em passos de **10%**;
- quando o volume pertence ao sistema/TV, a interface apenas indica **Volume da TV**.

Essa abordagem evita depender do comportamento de `input[type=range]` do Gecko/firmware para o D-pad.

## Crossfade na TV

No desktop/mobile a preferência de crossfade continua oferecendo o seletor completo de 0 a 30 segundos.

No modo TV, Minha conta substitui o `<select>` por quatro botões grandes e previsíveis:

```text
Desligado | 10 s | 20 s | 30 s
```

A seleção continua persistida pela mesma autoridade de preferências de reprodução existente. Durante a transição, o player inferior acompanha o mesmo progresso do crossfade de áudio: a **capa atual perde opacidade enquanto a próxima aparece**, e **título/artista atuais fazem fade-out enquanto os dados da próxima faixa fazem fade-in**. O objetivo é evitar uma troca visual brusca no fim do crossfade.

## Minha conta em mobile e TV

Para manter a tela de conta curta e focada em ações frequentes, quatro entradas avançadas ficam ocultas em **mobile (até 699 px)** e no **modo TV**:

- **Outros dispositivos**;
- **Apps e integrações**;
- **Importar dados pessoais**;
- **Administração**.

Essas funcionalidades não foram removidas: continuam disponíveis na experiência desktop. Alterar senha, Reprodução, Modo offline e Sair da conta continuam visíveis nas superfícies compactas quando aplicáveis.

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

O manifest declara:

```text
android.intent.category.LAUNCHER
android.intent.category.LEANBACK_LAUNCHER
```

O app também possui ícone `android:icon`, `android:roundIcon` e banner próprio do Home Music.

A opção **Adicionar à tela inicial** usa `ShortcutManager.requestPinShortcut()` quando o launcher expõe a API padrão. Launchers customizados podem ignorar ou não oferecer essa capacidade; nesse caso o app informa a limitação e continua disponível na lista de aplicativos.

## Controles Android

- **D-pad**: navega no frontend;
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

O workflow **Android TV** executa `assembleDebug` e `lintDebug` e publica `home-music-tv-debug-apk` como artifact. Alterações exclusivamente no frontend TV são validadas pelo CI web e não exigem gerar outro APK.

O CI web também possui um **TV regression gate** dedicado aos controles e à apresentação do crossfade antes do quality gate completo. Isso faz regressões de seek, volume, presets e transição visual falharem cedo no PR.

## Instalação de teste no BTV

1. baixe o artifact mais recente do workflow Android TV quando houver alteração no APK;
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

## Validação restante

A issue #392 continua sendo a fonte de verdade para testes no hardware real. Após cada deploy do modo TV, devem ser verificados foco e retorno entre zonas, Biblioteca, Busca, Playlists, seek de 10 segundos, volume, presets de crossfade, transição visual de capa/título/artista, login, overscan/escala e comportamento do launcher.
