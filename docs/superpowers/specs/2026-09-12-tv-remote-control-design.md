# Controle remoto do modo TV

## Estado

Implementado no PR #393. Este documento descreve o desenho efetivamente entregue; a homologação física de QR/câmera e interação no BTV 11 continua acompanhada pela issue #392.

## Objetivo

Permitir que uma pessoa autenticada no Home Music controle a reprodução aberta no modo TV usando o celular. O MVP oferece pareamento por QR Code e exatamente cinco comandos: play/pause, faixa anterior, próxima faixa, retroceder 10 segundos e avançar 10 segundos.

O celular não seleciona faixas, não edita a fila e não controla o volume do sistema da TV.

## Experiência

Na interface TV, **Controle pelo celular** abre um modal com:

- QR Code apontando para `/remote/<sessionId>` na mesma origem;
- endereço textual como fallback;
- estado aguardando/conectado/reconectando/erro;
- ação **Gerar novo código**.

O QR é gerado localmente pelo frontend, sem biblioteca ou serviço externo. Fechar/Escape apenas esconde o overlay e devolve o foco ao gatilho; a sessão continua ativa. Reabrir mostra a mesma sessão enquanto ela existir. **Gerar novo código** encerra a anterior e cria outra.

O modal mantém a navegação por D-pad dentro dos elementos focáveis e impede o recuperador global da TV de roubar foco para a tela de fundo.

Ao abrir a URL no celular, a autenticação normal continua sendo obrigatória. Depois do login, `App.tsx` reconhece a rota remota e monta uma superfície compacta com faixa, artista, progresso e controles.

## Autoridade de playback

A TV continua sendo a única autoridade de reprodução. O celular não monta `AuthenticatedApp`, `useAudioPlayer`, `useCrossfadeAudioPlayer` ou `<audio>`. Ele apenas envia comandos para o player que já existe na TV.

`AuthenticatedApp` mantém o `useCrossfadeAudioPlayer` canônico. `useTvRemoteSession` recebe somente estado atual e callbacks do player para publicar snapshots e aplicar comandos. As funções puras de snapshot/seek ficam em `tv-remote-tv-controller.ts`.

## Backend

O backend possui um `TvRemoteSessionManager` process-local e rotas em `/api/tv-remote/sessions`.

A sessão é efêmera:

- não cria migration;
- não entra em backup;
- não sobrevive ao restart do processo;
- possui no máximo três sessões ativas por usuário;
- expira após 60 segundos sem snapshot/heartbeat da TV;
- conserva somente os 32 eventos mais recentes.

Criar uma quarta sessão do mesmo usuário encerra a mais antiga.

## Transporte

O transporte é REST + Server-Sent Events (SSE):

- REST cria/encerra a sessão e publica comandos/snapshots;
- SSE entrega comandos à TV e snapshots ao celular;
- eventos recebem IDs monotônicos por sessão;
- `Last-Event-ID` permite replay curto após reconexão;
- heartbeat SSE mantém a conexão intermediária ativa;
- `EventSource` cuida da reconexão de transporte.

O heartbeat SSE não renova a sessão. Somente snapshots publicados pela TV renovam o TTL.

## Contratos compartilhados

```ts
type TvRemoteCommand =
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; deltaSeconds: -10 | 10 };

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

Valores fora da allowlist são rejeitados. Snapshot é apresentação descartável da TV e não substitui o estado canônico do player.

## API e segurança

Todas as rotas usam a política central `/api/*` e exigem sessão autenticada. Mutações exigem `X-Home-Music-Request: 1`.

- `POST /api/tv-remote/sessions` — cria sessão para `request.user.id`;
- `GET /api/tv-remote/sessions/:sessionId` — lê resumo/snapshot do mesmo usuário;
- `GET /api/tv-remote/sessions/:sessionId/events` — abre SSE do proprietário;
- `PUT /api/tv-remote/sessions/:sessionId/status` — TV publica snapshot e renova TTL;
- `POST /api/tv-remote/sessions/:sessionId/commands` — celular publica comando validado;
- `DELETE /api/tv-remote/sessions/:sessionId` — encerra a sessão.

O servidor nunca aceita `userId` do cliente. Sessão inexistente, expirada ou pertencente a outro usuário retorna a mesma resposta 404. O `sessionId` é opaco/aleatório, mas não funciona como autorização: o cookie da mesma conta continua obrigatório.

O frontend usa `keepalive: true` no DELETE de cleanup para aumentar a chance de encerramento durante desmontagem/navegação. Expiração cobre shutdowns abruptos em que a requisição não chega ao servidor.

## Frontend TV

A sessão é criada apenas por ação explícita da pessoa no modo TV. `useTvRemoteSession`:

- cria/substitui a sessão;
- abre SSE;
- publica snapshot imediatamente;
- limita atualizações materiais a aproximadamente 1 Hz;
- publica heartbeat/status a cada 15 s;
- usa o estado mais recente do player ao calcular seek;
- tenta DELETE em regeneração/unmount;
- mantém a sessão ao apenas esconder o modal.

O botão e o modal existem somente na experiência TV. A lógica do hook pode estar composta em `AuthenticatedApp`, mas nenhuma sessão é criada fora da ação visível do modo TV.

## Frontend celular

`App.tsx` resolve `/remote/<sessionId>` somente depois de autenticação/offline e antes de `AuthenticatedApp`.

A tela remota:

- valida a sessão via GET;
- abre SSE e acompanha snapshots;
- exibe conexão/reconexão, faixa, artista e progresso;
- serializa comandos: enquanto uma mutação está em voo, os controles ficam temporariamente desabilitados;
- trata 404 como sessão inexistente/encerrada;
- não cria áudio local.

## QR Code

`apps/web/src/tv-remote-qr.ts` implementa geração SVG local, versão 10 com correção M para o tamanho esperado das URLs de pareamento. O resultado é usado como `data:image/svg+xml` em `<img>`, sem `dangerouslySetInnerHTML` e sem transmitir a URL a terceiros.

A URL textual permanece disponível caso a câmera/decoder do aparelho não leia o QR. A leitura física do QR no BTV/celular continua requisito de homologação, porque o E2E não simula câmera.

## Testes

### Servidor

- sessão, cap por usuário, TTL e cleanup;
- ownership entre identidades e 404 indistinguível;
- validação de comandos/snapshots;
- replay, IDs, heartbeat e fechamento SSE;
- autenticação/CSRF;
- backpressure e shutdown do Fastify.

### Frontend

- parser da rota remota;
- cliente HTTP/SSE e deduplicação;
- `keepalive` de cleanup;
- mapeamento de comandos e seek;
- normalização de snapshot;
- geração local do QR.

### E2E

`e2e/tests/tv-remote-control.spec.ts` usa dois contexts do Chromium autenticados na mesma conta para provar:

- abertura do pareamento pela UI da TV;
- D-pad isolado no modal e retorno de foco ao fechar;
- sessão ativa depois de esconder o overlay;
- ausência de `<audio>` no celular;
- sincronização play/pause nos dois sentidos;
- próxima faixa e seek enviados pelo celular.

O isolamento entre contas é testado na integração HTTP real de `tv-remote-routes.test.ts`, onde outro usuário recebe 404 em consulta/comandos e demais endpoints da sessão.

## CI e homologação

O CI fixo inclui TV regression gate, quality, security, backup smoke, Mobile crossfade E2E, TV remote control E2E, Personal data import E2E e Library Assistant E2E.

CI verde prova o contrato automatizado, mas não substitui BTV 11 real. Permanecem físicos: câmera/QR, legibilidade a distância, D-pad do controle real, overscan e comportamento específico do GeckoView/firmware.

## Fora do escopo

- escolher músicas/navegar na biblioteca pelo celular;
- editar ou reordenar fila;
- controlar volume do sistema;
- controlar múltiplas TVs na mesma tela;
- persistir sessões após restart;
- acesso sem autenticação ou por outra conta;
- funcionamento offline.
