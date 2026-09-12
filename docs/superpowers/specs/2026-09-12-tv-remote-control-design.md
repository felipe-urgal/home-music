# Controle remoto do modo TV

## Objetivo

Permitir que uma pessoa autenticada no Home Music controle a reprodução aberta no modo TV usando o celular. O primeiro corte deve ser simples e previsível: pareamento por QR Code e comandos de play/pause, faixa anterior, próxima faixa, retroceder 10 segundos e avançar 10 segundos.

O controle não seleciona faixas, não edita a fila e não tenta alterar o volume do sistema da TV. O controle físico continua responsável pelo volume quando o player usa `usesSystemVolume`.

## Experiência

Na interface TV, uma ação **Controlar pelo celular** abre um painel central com:

- QR Code apontando para a URL desta instalação, em `/remote/<sessionId>`;
- endereço curto em texto como fallback;
- estado de pareamento: aguardando, celular conectado ou conexão encerrada;
- ação para gerar uma nova sessão.

Ao ler o QR Code, o celular abre a mesma instalação do Home Music. Se a pessoa ainda não estiver autenticada, faz login normalmente e permanece na URL remota. Depois da autenticação, aparece uma superfície compacta com a faixa atual, artista, estado de reprodução, progresso e os cinco comandos do MVP.

O celular não monta `AuthenticatedApp` nem `useAudioPlayer`. Ele é somente um controle do player que já existe na TV, evitando reprodução duplicada e disputa pelo estado persistido da conta.

## Arquitetura escolhida

O backend terá um `TvRemoteSessionManager` em memória e um módulo de rotas autenticadas em `/api/tv-remote`. A sessão é efêmera: não cria migration, não entra em backup e desaparece quando o servidor reinicia ou quando a TV encerra o vínculo.

O transporte será REST + Server-Sent Events (SSE):

- REST cria/encerra a sessão e publica comandos ou snapshots do player;
- um stream SSE entrega comandos à TV e snapshots ao celular com baixa latência;
- eventos possuem ID crescente e um buffer curto para reconexão via `Last-Event-ID`;
- heartbeats mantêm proxies e conexões intermediárias ativos;
- `EventSource` reconecta automaticamente após uma interrupção temporária.

Essa solução evita adicionar infraestrutura de WebSocket e preserva o Fastify como servidor único. O único pacote novo previsto é uma biblioteca pequena e fixada para gerar o QR Code no frontend; a geração não depende de serviço externo.

## Contratos compartilhados

`@home-music/shared` definirá unions discriminadas e respostas consumidas pelas duas pontas.

### Comando

```ts
type TvRemoteCommand =
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; deltaSeconds: -10 | 10 };
```

Valores fora dessa allowlist são rejeitados pelo servidor. O cliente não envia funções, IDs de usuário, posição absoluta nem valores arbitrários de seek.

### Snapshot

```ts
type TvRemotePlaybackSnapshot = {
  trackId: string | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  updatedAt: string;
};
```

Tempos são normalizados para números finitos e limitados ao intervalo válido. O snapshot é apresentação descartável da TV, não uma segunda autoridade do player e não substitui `/api/player/state`.

## API

Todas as rotas abaixo permanecem dentro da política central `/api/*` e exigem sessão autenticada. Mutações exigem `X-Home-Music-Request: 1`.

- `POST /api/tv-remote/sessions` — cria uma sessão pertencente a `request.user.id`.
- `GET /api/tv-remote/sessions/:sessionId` — retorna metadados e o último snapshot somente ao mesmo usuário.
- `GET /api/tv-remote/sessions/:sessionId/events` — abre o stream SSE do proprietário.
- `PUT /api/tv-remote/sessions/:sessionId/status` — TV publica heartbeat e snapshot normalizado.
- `POST /api/tv-remote/sessions/:sessionId/commands` — celular publica um comando validado.
- `DELETE /api/tv-remote/sessions/:sessionId` — TV encerra a sessão.

O servidor nunca aceita `userId` do cliente. Sessão inexistente, expirada ou de outro usuário produz a mesma resposta 404, evitando enumeração. O `sessionId` é aleatório e possui entropia suficiente para aparecer na URL sem funcionar como autorização; a sessão autenticada da mesma conta continua obrigatória.

## Ciclo de vida e limites

- no máximo três sessões remotas ativas por usuário; criar uma quarta remove a mais antiga;
- a TV renova a sessão por heartbeat enquanto a superfície está montada;
- sessão sem heartbeat da TV expira após 60 segundos;
- comandos e eventos têm payload pequeno e tamanho limitado pelas validações existentes do Fastify;
- cada sessão conserva somente os eventos recentes necessários para uma reconexão curta;
- ao desmontar, a TV tenta `DELETE` com `keepalive`; expiração cobre encerramentos abruptos;
- no shutdown, o manager cancela timers, encerra streams e libera listeners.

Uma sessão expirada informa o celular de forma explícita e oferece somente voltar ou ler um novo QR Code. O cliente não tenta recriar uma TV remotamente.

## Frontend TV

Um hook `useTvRemoteSession` pertence à composição online e só é ativado quando `isTvMode()` é verdadeiro. Ele:

- cria a sessão sob ação explícita da pessoa na TV;
- abre o stream SSE;
- traduz comandos válidos para as operações canônicas já expostas por `useCrossfadeAudioPlayer`;
- publica snapshots derivados do player de forma limitada, além de heartbeat periódico;
- deduplica eventos por ID após reconexão;
- encerra a sessão no cleanup.

`TvExperience` recebe apenas estado e callbacks de apresentação para abrir/fechar o painel. Ele não chama API nem controla o manager diretamente.

## Frontend celular

`App.tsx` reconhece `/remote/<sessionId>` depois de resolver autenticação e monta `TvRemoteControlScreen` antes de `AuthenticatedApp`. Assim, login, expiração de sessão e conectividade continuam sob a autoridade de `App`, mas biblioteca, navegação e player locais não são inicializados.

A tela remota:

- valida a sessão com GET e abre o stream;
- mostra conexão, faixa e progresso recebidos da TV;
- envia um comando por clique e evita múltiplos envios enquanto a requisição correspondente está em voo;
- trata 401 pelo fluxo global de autenticação e 404 como sessão encerrada;
- mantém alvos de toque grandes, nomes acessíveis e feedback que não depende só de cor.

## QR Code e segurança de navegação

O QR Code é gerado localmente a partir de `window.location.origin` e do `sessionId` retornado pelo servidor. Nenhum endereço, token ou dado de reprodução é enviado a terceiros. A URL usa o mesmo protocolo e host já abertos na TV.

O HTML de produção continua com `Referrer-Policy: no-referrer`. O identificador remoto não concede acesso sem o cookie autenticado e não é persistido em logs de aplicação além do tratamento normal da URL pelo servidor.

## Testes

### Servidor

- criação, limite por usuário, heartbeat, expiração e cleanup;
- ownership entre duas identidades e resposta indistinguível para sessão alheia;
- rejeição de comando, snapshot e números inválidos;
- ordenação, deduplicação e replay curto de eventos;
- exigência de autenticação e proteção anti-CSRF nas mutações.

### Frontend

- parsing seguro de `/remote/<sessionId>` e preservação da rota após login;
- mapeamento de cada comando para a operação canônica do player;
- deduplicação dos eventos e cleanup de timers/EventSource;
- estados aguardando, conectado, encerrado e erro;
- geração do link de pareamento somente para a origem atual.

### E2E

Um cenário com dois contexts autenticados abre a TV, cria o pareamento, abre a URL remota no viewport mobile e confirma que play/pause, próxima e seek alteram o player da TV. O teste também confirma que uma segunda conta não consegue consultar nem comandar a sessão.

Os gates finais são `npm run check`, `npm run test:security` e a spec E2E focada. A validação no BTV 11 permanece manual porque autoplay, scanner de QR e volume do sistema dependem do hardware.

## Documentação

Atualizar:

- `docs/android-tv.md` com pareamento, comandos, limites e validação em hardware;
- `docs/app-composition.md` com a superfície remota acima de `AuthenticatedApp`;
- `docs/server-composition.md` com manager, rotas e lifecycle;
- `docs/testing-and-quality.md` caso o E2E remoto seja promovido a gate fixo do workflow.

## Fora do escopo

- selecionar músicas ou navegar na biblioteca pelo celular;
- editar/reordenar fila;
- controlar volume do sistema da TV;
- controlar mais de uma TV ao mesmo tempo na mesma tela;
- persistir sessões após restart do servidor;
- acesso sem autenticação ou por conta diferente;
- funcionamento no modo offline.
