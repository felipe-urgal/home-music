# Composição da aplicação

A composição do frontend mantém sessão, navegação e playback com responsabilidades explícitas, sem criar fontes paralelas de estado.

## App

`App.tsx` é a raiz de sessão e conectividade. Ele:

- inicializa autenticação e downloads offline em paralelo;
- decide entre loading de sessão, login, aplicação autenticada, aplicação offline e superfície remota;
- controla entrada e saída manual do modo offline;
- deriva a entrada offline automática de `auth.unreachable` + manifesto físico local;
- mantém `OfflineApp` no shell inicial;
- não conhece a composição interna de biblioteca/player.

Depois de resolver autenticação/offline, `App` examina a URL autenticada. Uma rota válida `/remote/<sessionId>` monta `TvRemoteControlScreen` **antes** de `AuthenticatedApp`. Dessa forma o celular reutiliza sessão/autenticação da raiz, mas não inicializa biblioteca nem player online e não cria `<audio>`.

Rotas normais continuam montando `AuthenticatedApp`.

## AuthenticatedApp

`AuthenticatedApp.tsx` compõe a experiência autenticada e mantém juntas as fontes globais que compartilham ciclo de vida:

- `useLibraryData` para biblioteca/playlists;
- `useLibraryNavigation` e `useRoutedScreen` para navegação;
- `useCrossfadeAudioPlayer` sobre o `useAudioPlayer` canônico;
- continuidade, preload, qualidade de rede e preferência de volume;
- shells e superfícies mobile/desktop/TV;
- dados/callback de entrada manual no modo offline;
- `useTvRemoteSession`, que recebe estado e callbacks do player existente.

No modo TV, `useTvRemoteSession` prepara uma sessão efêmera em background para que o pareamento esteja pronto sem atrasar a interação. Isso não abre automaticamente o QR: a ação explícita **Controlar pelo celular** apenas abre a apresentação da sessão preparada. O QR fica abaixo do CTA e é escondido quando o controlador remoto realmente conecta.

O controle remoto não adiciona um segundo player. `useTvRemoteSession` deriva snapshots do mesmo `useCrossfadeAudioPlayer` e converte comandos remotos para os callbacks canônicos de play/pause, anterior, próxima, seek legado, shuffle, repeat e Crossfade. `play-track` solicita a faixa ao mesmo fluxo de reprodução da TV.

Para `set-crossfade`, a TV é a autoridade. A sessão anuncia `capabilities.crossfadeControl: true`; ao receber o comando SSE, `useTvRemoteSession` aplica `onSetCrossfadeSeconds`, avança o watermark `lastAppliedCrossfadeCommandId` para o `eventId` consumido e agenda a publicação do snapshot canônico. `createTvRemoteStatusPublisher` mantém uma única publicação em voo e agrega alterações concorrentes, reduzindo risco de reordenação do estado publicado.

`useCrossfadeAudioPlayer` mantém a preferência e os dois decks necessários apenas durante uma transição natural. Ações manuais passam pelo ponto canônico `beforeManualPlaybackChange`, que cancela preload/crossfade pendente antes de Next, Previous, seek ou seleção explícita. A continuidade com Crossfade permanece restrita ao avanço natural de fim de faixa; o remote não altera essa regra.

`A SEGUIR` recebe a decisão da fila canônica do player em vez de derivar a próxima faixa da biblioteca completa.

Extrair esses hooks para stores/contexts independentes sem necessidade concreta voltaria a espalhar estado global e não faz parte desta arquitetura.

## Superfície `/remote/<sessionId>`

`authenticatedSurfaceForPath` separa a rota remota do roteamento interno comum. O `sessionId` é um segmento opaco com encode/decode explícito.

`TvRemoteControlScreen`:

- valida a sessão remota autenticada;
- abre SSE para snapshots, comandos de ciclo de vida e encerramento;
- considera **TV conectada** somente quando o transporte ao servidor está aberto **e** existe snapshot recente da TV;
- espera o `ready` pós-replay antes de considerar o estado inicial do Crossfade consistente;
- mostra faixa, progresso, shuffle, repeat e Crossfade quando a TV anuncia suporte;
- envia comandos serializados;
- oferece uma tela secundária de Biblioteca para buscar e escolher faixas;
- nunca monta `AuthenticatedApp`, `useAudioPlayer` ou `<audio>`.

O endpoint SSE reproduz primeiro os eventos após `Last-Event-ID` e só depois emite `ready`. Assim, abertura do transporte e conclusão do replay são sinais distintos.

O ajuste de Crossfade usa `useRemoteCrossfade` como adaptador React e `remote-crossfade-controller.ts` como controlador de intenção. O controlador guarda somente estado transitório de UI (`pending`/mensagem) e nunca vira uma segunda fonte de verdade do valor. Ele:

- envia `set-crossfade` e recebe o `commandEventId` do `202`;
- confirma sucesso apenas quando o snapshot canônico traz o mesmo id e o valor solicitado;
- tolera o snapshot chegar antes da resposta HTTP;
- usa o watermark para reconhecer quando outro controlador prevaleceu;
- aborta após 10 segundos sem confirmação;
- descarta a intenção ao desconectar, trocar de sessão ou desmontar;
- ignora respostas tardias de uma intenção já encerrada.

`crossfadeSeconds` e `lastAppliedCrossfadeCommandId` são publicados como par atômico. Clientes/sessões antigos podem omitir ambos; nesse caso a tela remota mantém o ajuste de Crossfade indisponível sem afetar os demais controles.

O telefone é um controle do player da TV, não outra superfície de reprodução.

## Superfície de TV e foco

`TvExperience` mantém o CTA **Controlar pelo celular** fora do `<main>` da experiência musical. Dentro do `<main>`, a capa atual é a ação primária de Play/Pause e a área **A SEGUIR** executa Next quando existe próxima faixa.

A navegação por D-pad conecta o CTA externo à ação primária por Arrow Up/Down e percorre as ações internas disponíveis por Arrow Left/Right. A referência de recuperação de foco pertence apenas ao foco efetivamente mantido dentro do `<main>`: quando o usuário migra para o CTA externo, a referência interna é limpa. Se um controle interno some durante atualização da fila, o fallback ainda consegue escolher uma ação válida sem roubar um foco que já está fora da experiência.

## OfflineApp

`OfflineApp.tsx` compõe a experiência isolada de downloads offline. Ele mantém:

- navegação local entre biblioteca offline e player;
- uma instância de `useCrossfadeAudioPlayer` com `offlineMode: true`;
- continuidade de reprodução offline e fallback de transição;
- shell/barra do player reutilizados;
- saída pelo callback de `App.tsx`, que restaura a experiência online.

O player offline é separado porque opera com outra coleção/persistência, mas cada modo mantém uma única fonte de verdade. O segundo deck de crossfade é somente uma transição temporária adotada pelo `useAudioPlayer` no handoff.

## Regras

- `App.tsx` não deve concentrar composição interna de biblioteca/player;
- `LoginScreen` não decide entrada automática no modo offline;
- biblioteca, navegação e playback não devem ser duplicados entre `App`, `AuthenticatedApp` e filhos;
- `/remote/<sessionId>` deve continuar acima de `AuthenticatedApp` para impedir áudio local no controlador;
- o controle remoto da TV deve usar o player canônico, nunca uma store paralela;
- `202` de `set-crossfade` não é confirmação de aplicação; o snapshot canônico com watermark decide o resultado;
- o lifecycle transitório de uma intenção remota deve ser descartado em timeout, disconnect, troca de sessão e unmount;
- ações manuais devem cancelar Crossfade/preload natural pendente antes de alterar a reprodução;
- diferenças mobile/desktop/TV pertencem às superfícies responsáveis;
- mudanças de composição devem preservar autenticação, deep links, retomada do player, offline e comportamento responsivo;
- conexão do celular ao servidor não deve ser confundida com presença da TV; a presença é derivada dos snapshots/heartbeats recentes;
- resposta válida do servidor informando sessão inválida continua exigindo autenticação online.

Este desenho corresponde ao refactor da issue #115, às evoluções offline #258/#259/#328 e ao controle remoto TV iniciado no PR #393 e evoluído no PR #398.
