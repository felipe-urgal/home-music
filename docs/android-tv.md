# Home Music TV / Android TV

O Home Music possui um cliente Android TV em `android-tv/` para abrir a aplicação web em tela cheia em TVs e boxes Android. O alvo inicial é o **BTV 11**; o projeto mantém compatibilidade com Android 6/API 23 ou superior quando o firmware oferece os recursos necessários.

O cliente Android não replica backend, biblioteca ou autenticação. Ele abre o frontend existente com `?tv=1`, mantendo o servidor Home Music como autoridade única para sessão, biblioteca, player e dados pessoais.

## Estado atual

O cliente Android e o primeiro modo TV entraram no PR #391. A segunda iteração de UX e o controle pelo celular são desenvolvidos no PR #393 e acompanhados pela issue #392.

Já foi confirmado em um BTV 11 real que:

- o APK instala após os ajustes de compatibilidade do package installer;
- o app abre o servidor em tela cheia;
- o WebView original do aparelho não suporta adequadamente o frontend atual, por isso o APK embarca GeckoView;
- `?tv=1` ativa a experiência dedicada;
- login, navegação TV v2, player, seek, volume aplicável, presets de crossfade, crossfade audiovisual, overscan e persistência foram exercitados no hardware na rodada anterior da #392.

A versão de APK de teste continua `0.4.0` (`versionCode 5`). As mudanças do PR #393 são web/server e não exigem reinstalar o APK depois do deploy.

## Arquitetura

```text
BTV / Android TV
      |
      v
Home Music TV APK
  - Activity Android
  - GeckoView embarcado
  - URL persistida localmente
      |
      | abre com ?tv=1
      v
Frontend Home Music
  - login para TV
  - layout 16:9
  - navegação D-pad
  - player canônico
  - pareamento do celular
      |
      v
Servidor Home Music
  - auth/biblioteca/player state
  - sessão remota efêmera REST + SSE
      |
      v
SQLite / MUSIC_DIR
```

O projeto Android fica fora dos workspaces npm. O CI web não depende de Gradle/Android SDK; existe workflow separado em `.github/workflows/android-tv.yml`.

## URL do servidor

Na primeira configuração, o campo vem pré-preenchido com:

```text
https://home-music.tail6ab100.ts.net/
```

O usuário pode trocar por outro endereço `https://` ou `http://`. A escolha fica em `SharedPreferences` no aparelho.

Ao abrir o site, o APK acrescenta `tv=1`. O frontend preserva o modo TV durante a sessão sem mudar desktop, celular ou PWA.

## Interface TV v2

A sidebar principal contém:

- **Início**;
- **Biblioteca**;
- **Buscar**;
- **Playlists**.

Biblioteca agrupa **Pastas**, **Álbuns**, **Artistas** e **Músicas** como abas grandes. **Minha conta** fica no topo. A Home mostra Pastas + Álbuns em destaque para reduzir elementos simultâneos e saltos de foco.

## Navegação por D-pad

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
- setas no conteúdo permanecem naquela zona enquanto houver destino útil;
- ↓ no limite inferior entra no player;
- ↑ no player retorna ao conteúdo;
- OK/Enter ativa o item focado;
- foco visível e scroll acompanham a navegação.

Login, telas utilitárias e Minha conta também recebem navegação auxiliar por D-pad.

### Modal do controle pelo celular

O modal de pareamento é uma superfície modal real: ao abrir, o foco entra nele; setas percorrem seus elementos focáveis; o recuperador global não move o foco para a tela de fundo; Escape/fechar escondem o overlay e devolvem foco ao botão **Controle pelo celular**.

## Player para TV

No player inferior:

- anterior, play/pause e próxima são ações diretas;
- progresso é focável; ←/→ fazem seek de **10 s**;
- quando o Home Music controla volume internamente, ←/→ mudam **10%**;
- quando o volume é do sistema, a UI indica **Volume da TV**.

Isso evita depender de `input[type=range]` pequeno ou do comportamento do firmware.

## Crossfade na TV

Desktop/mobile mantêm o seletor completo de 0 a 30 s. No modo TV, Minha conta usa quatro botões:

```text
Desligado | 10 s | 20 s | 30 s
```

Durante a transição, capa, título e artista acompanham o progresso do crossfade de áudio.

## Controle pelo celular

No modo TV, **Controle pelo celular** cria uma sessão remota efêmera no servidor e mostra:

- QR Code gerado localmente no navegador;
- URL textual como fallback;
- estado da conexão;
- ação **Gerar novo código**.

O QR aponta para `/remote/<sessionId>` na mesma instalação. Nenhuma URL é enviada a serviço externo.

O celular precisa estar autenticado na **mesma conta**. A tela remota não cria player local nem `<audio>`; ela envia somente:

- play/pause;
- anterior;
- próxima;
- -10 s;
- +10 s.

Fechar o overlay na TV apenas o esconde e mantém a sessão viva. Gerar novo código substitui a sessão anterior. Sessões são process-local, limitadas a três por usuário e expiram após 60 s sem heartbeat/status da TV. Reiniciar o servidor invalida os vínculos.

Arquitetura e segurança detalhadas: [`tv-remote-control.md`](tv-remote-control.md).

## Minha conta em mobile e TV

Para manter a tela curta, ficam ocultos em mobile (até 699 px) e TV:

- Outros dispositivos;
- Apps e integrações;
- Importar dados pessoais;
- Administração.

As funções continuam disponíveis no desktop. Alterar senha, Reprodução, Modo offline e Sair permanecem visíveis quando aplicáveis.

## Login

O login usa a autenticação web normal. O APK não recebe nem armazena senha por bridge nativa.

No modo TV os alvos são maiores, o foco é visível, D-pad vertical percorre campos/ações e o teclado vem do Android/BTV. Cookies/storage do GeckoView preservam a sessão no armazenamento privado do app.

## Compatibilidade com BTV 11

### Package installer

Para evitar o erro de análise de pacote encontrado no primeiro APK:

- `minSdk` 23;
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
gradle -p android-tv :app:assembleDebug
```

APK:

```text
android-tv/app/build/outputs/apk/debug/app-debug.apk
```

O workflow **Android TV** executa `assembleDebug` + `lintDebug` e publica `home-music-tv-debug-apk`. Mudanças exclusivamente web/server do modo TV são validadas pelo CI principal e não exigem outro APK.

O CI web contém TV regression gate e TV remote control E2E, além dos gates gerais descritos em [`testing-and-quality.md`](testing-and-quality.md).

## Instalação de teste

1. baixe o artifact Android TV quando houver alteração do APK;
2. extraia `app-debug.apk` se necessário;
3. copie/baixe no aparelho;
4. permita fonte desconhecida para o instalador usado;
5. instale;
6. abra Home Music TV;
7. confirme a URL;
8. faça login e valide usando somente o controle.

Builds de teste com assinatura incompatível podem exigir reinstalação limpa, removendo URL/login locais.

## Assinatura release

O APK debug é para sideload/validação. Releases atualizáveis precisam da mesma chave privada.

```text
ANDROID_TV_KEYSTORE_PATH
ANDROID_TV_KEYSTORE_PASSWORD
ANDROID_TV_KEY_ALIAS
ANDROID_TV_KEY_PASSWORD
```

O keystore não deve ser commitado e precisa de backup seguro.

## Segurança

- nenhuma bridge JavaScript nativa é exposta;
- autenticação/autorização permanecem no backend;
- URL fica no storage privado do app;
- HTTPS é preferido; HTTP permanece para instalações locais controladas;
- erros TLS não são ignorados;
- controle remoto exige a mesma conta autenticada e usa sessão opaca/efêmera;
- QR é gerado localmente e não concede autorização por si só.

## Validação restante

A issue #392 continua sendo a fonte de verdade para hardware/distribuição. A rodada TV v2 anterior já foi validada no BTV; após o deploy do controle remoto ainda precisam de teste físico:

- leitura do QR pela câmera de um celular e legibilidade a distância;
- login/retorno para `/remote/<sessionId>` quando o celular não estiver autenticado;
- play/pause, anterior/próxima e seek ±10 s controlando o BTV real;
- esconder/reabrir o overlay sem perder a sessão;
- gerar novo código e confirmar invalidação do anterior;
- foco do modal com o D-pad físico e retorno ao botão de origem;
- layout/overscan do modal no televisor;
- reconexão/comportamento da sessão no GeckoView real.

Os itens de assinatura release e estratégia de distribuição também permanecem na #392.
