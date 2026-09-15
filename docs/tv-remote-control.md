# Controle remoto da TV pelo celular

O modo TV do Home Music permite usar um celular autenticado na **mesma conta** como controle remoto. A reprodução continua pertencendo ao player canônico da TV; a rota remota no celular não cria `<audio>` nem reproduz mídia localmente.

## Fluxo

1. Ao montar o modo TV, `useTvRemoteSession` prepara uma sessão efêmera em background e começa a publicar o estado do player.
2. O card **Controlar pelo celular** permanece disponível no topo direito.
3. Ao ativar o card, a TV exibe o QR abaixo dele, sem cobrir o gatilho.
4. O QR é gerado localmente no frontend; o endereço de pareamento não é enviado a serviço externo.
5. Se necessário, o celular autentica com a mesma conta e abre `/remote/<sessionId>`.
6. A validação da rota sinaliza `remote-connected` à TV; o QR é escondido quando o controlador realmente carrega, enquanto o card permanece visível.
7. O celular envia comandos ao servidor e a TV os recebe por SSE, aplicando-os ao player existente.

A sessão preparada em background não significa que a interface de pareamento esteja aberta. Reabrir o card pode reapresentar o QR da sessão ativa; regenerar encerra a sessão anterior e cria outra.

## Protocolo

Os comandos atuais são:

- play/pause (`toggle-play`);
- faixa anterior (`previous`);
- próxima faixa (`next`);
- alternar aleatório (`toggle-shuffle`);
- alternar repetição (`cycle-repeat`);
- escolher uma faixa da biblioteca (`play-track`);
- ajustar Crossfade (`set-crossfade`) com um inteiro de `0` a `30` segundos.

Os comandos legados de seek (`seek: -10` e `seek: +10`) continuam aceitos por compatibilidade, mas não fazem parte dos controles primários da interface atual do celular.

A sessão anuncia suporte ao ajuste remoto por `capabilities.crossfadeControl: true`. Um cliente antigo pode receber e ignorar essa propriedade; da mesma forma, snapshots antigos podem não conter dados de Crossfade. O telefone só habilita o seletor quando a sessão anuncia a capability e a conexão já alcançou um snapshot canônico compatível.

O snapshot publicado pela TV contém `trackId`, título, artista, estado de reprodução, posição, duração e `updatedAt`. Quando disponíveis, também inclui `shuffle` e `repeatMode`.

Para Crossfade, `crossfadeSeconds` e `lastAppliedCrossfadeCommandId` formam um **par atômico**: ambos estão presentes e válidos ou ambos ficam ausentes. `crossfadeSeconds` permanece entre `0` e `30`; `lastAppliedCrossfadeCommandId` é o watermark do último comando `set-crossfade` efetivamente aplicado pela TV. O servidor e o cliente rejeitam snapshots com apenas metade do par.

## Confirmação de Crossfade e concorrência

`POST /api/tv-remote/sessions/:sessionId/commands` aceita `set-crossfade` com `202` e retorna `{ commandEventId }`. Esse `202` confirma apenas que o servidor publicou o comando; **não** confirma que a TV aplicou o novo valor.

A TV recebe o comando por SSE usando o mesmo `eventId`, grava esse id como `lastAppliedCrossfadeCommandId`, aplica `setCrossfadeSeconds` no player canônico e publica um novo snapshot. O celular considera o ajuste concluído somente quando observa o par canônico:

- `lastAppliedCrossfadeCommandId === commandEventId`; e
- `crossfadeSeconds ===` o valor solicitado.

Essa confirmação é intencionalmente independente da ordem entre HTTP e SSE. O snapshot pode chegar antes da resposta `202`; o controlador mantém o snapshot mais recente e o reconcilia assim que recebe o `commandEventId`.

Se o watermark observado ultrapassa o id pendente, outro controlador venceu a corrida e o telefone informa que outra alteração prevaleceu. Se o id é o mesmo, mas o valor diverge, o valor canônico da TV também prevalece. Assim, dois celulares podem enviar ajustes sem criar estado paralelo ou sucesso falso.

Uma intenção fica pendente por no máximo 10 segundos. Timeout aborta a requisição com `AbortController`; desconexão, troca de sessão ou desmontagem também descartam a intenção. Respostas HTTP ou snapshots tardios de uma intenção já encerrada não podem reativar sucesso ou erro antigos.

O publicador da TV (`createTvRemoteStatusPublisher`) mantém no máximo uma publicação de status em voo e agrega mudanças concorrentes no snapshot mais recente. Isso evita reordenação local das publicações e preserva o watermark que corresponde ao estado efetivamente aplicado.

## Replay, `ready` e presença

O endpoint SSE primeiro reproduz os eventos mantidos no buffer depois de `Last-Event-ID` e **só então** emite `event: ready`. Portanto, `ready` significa que o replay inicial alcançou a fronteira corrente daquela conexão; não é sinônimo do simples `onopen` do transporte.

A TV publica mudanças materiais no máximo uma vez por segundo e também envia heartbeat periódico a cada 15 segundos. No servidor, a sessão expira quando a TV deixa de atualizar o heartbeat por 60 segundos.

No celular, `EventSource` aberto significa apenas que o controlador alcança o servidor. O rótulo **TV conectada** e a habilitação dos controles dependem também de um snapshot recente da TV. Depois de dois heartbeats perdidos (30 segundos sem snapshot recebido), a TV é tratada como desconectada até chegar nova atualização. Para Crossfade, a tela também espera o replay `ready`, a capability da sessão e o par canônico do snapshot antes de habilitar o seletor.

Há no máximo três sessões simultâneas por usuário; ao ultrapassar o limite, a mais antiga é encerrada. Reiniciar o processo do servidor invalida as sessões em memória.

## Player e regras de Crossfade

`AuthenticatedApp` continua dono de `useCrossfadeAudioPlayer`, que é a única fonte de verdade para o valor persistido e para a reprodução. O remote apenas solicita a alteração; não mantém uma preferência concorrente.

Crossfade de áudio é permitido na transição **natural** de fim de faixa. Ações manuais de transporte ou seleção — incluindo Next, Previous, seek e escolha explícita de faixa, inclusive quando originadas pela TV ou pelo remote — passam pelo ponto canônico de cancelamento antes de trocar a reprodução. Um preload/crossfade natural pendente é descartado, o deck secundário é limpo e a troca manual ocorre imediatamente. Alterar a própria preferência de Crossfade também cancela uma transição em andamento antes de persistir o novo valor.

O valor `0` continua significando avanço natural imediato, sem sobreposição de áudio. O celular nunca toca áudio: ele controla o player que permanece na TV.

## Segurança

- todos os endpoints exigem a autenticação normal do Home Music;
- a sessão pertence ao usuário que a criou;
- outro usuário recebe o mesmo `404` usado para sessão inexistente ou expirada;
- mutações usam `X-Home-Music-Request: 1` além do cookie same-origin;
- o identificador da sessão é opaco e aleatório;
- o QR é gerado no navegador e não usa serviço remoto;
- regenerar ou desmontar a TV tenta remover a sessão anterior no servidor;
- SSE é encerrado no cleanup do frontend e no shutdown do servidor.

## Composição do frontend

`App.tsx` seleciona a superfície autenticada `/remote/<sessionId>` antes de `AuthenticatedApp`, impedindo que o celular inicialize o player online.

Na TV, `AuthenticatedApp` continua dono de `useCrossfadeAudioPlayer`. `useTvRemoteSession` recebe o estado e callbacks canônicos de play/pause, anterior, próxima, seek legado, shuffle, repeat e Crossfade. Escolhas da biblioteca chegam como `play-track` e são encaminhadas ao mesmo player.

No celular, `TvRemoteControlScreen` usa `useRemoteCrossfade`. O hook é apenas o adaptador React; o lifecycle da intenção fica em `remote-crossfade-controller.ts`, que centraliza timeout, abort, confirmação por watermark, descarte por disconnect/session e proteção contra respostas tardias.

A TV mostra **A SEGUIR** a partir da decisão canônica da fila, inclusive em shuffle e nos modos Repeat All/Repeat One.

## Foco e acessibilidade

A TV define o foco inicial ao montar a experiência, mas não o redefine em cada troca de faixa. Assim, autoplay, Next ou escolha remota não interrompem a navegação por D-pad.

O gatilho **Controlar pelo celular** é uma área de foco externa ao `<main>` da experiência. Dentro do `<main>`, a capa atual é a ação primária de Play/Pause e a área **A SEGUIR** é a ação de Next quando existe. Arrow Up/Down conecta o gatilho externo à ação primária e Arrow Left/Right percorre os controles internos disponíveis.

A referência usada para recuperação de foco é limpa quando o foco realmente migra para uma área externa. Se um controle interno previamente focado desaparecer, a recuperação ainda escolhe uma ação interna válida ou o gatilho externo; se o usuário já estiver em **Controlar pelo celular**, mudanças de faixa não roubam esse foco.

No celular, entrar em **Biblioteca** move o foco para **Voltar ao controle**; voltar restaura o foco no gatilho da Biblioteca. Erros de seleção de faixa são exibidos junto à área da Biblioteca, próximos da ação que falhou.

A cor de destaque extraída da capa é normalizada para preservar contraste mínimo de 3:1 com os ícones brancos dos controles principais.

## Testes e CI

A cobertura inclui parser de rota, comandos e snapshots ampliados, presença remota, contrato compartilhado, contraste da paleta, adaptação dos comandos ao player e o lifecycle assíncrono do ajuste remoto de Crossfade.

Os testes determinísticos de `remote-crossfade-controller` cobrem:

- snapshot de confirmação chegando antes da resposta HTTP `202`;
- timeout, aborto e resposta tardia sem ressuscitar sucesso;
- disconnect e troca/descarte de sessão com intenção em voo;
- dois controladores concorrentes resolvidos pelo watermark canônico.

O E2E `e2e/tests/tv-remote-control.spec.ts` usa dois contextos de navegador e valida, entre outros pontos:

- CTA e QR sem sobreposição;
- desaparecimento do QR quando o celular conecta;
- ausência de `<audio>` no celular;
- play/pause, próxima faixa, shuffle, repeat e Crossfade `0/3/5/30`;
- `A SEGUIR` em Repeat One;
- preservação do foco externo quando uma ação interna desaparece;
- transferência e restauração de foco ao entrar/sair da Biblioteca.

O CI executa o **TV remote control E2E** depois do Mobile crossfade E2E.

## Limitações e validação física

O fluxo usa uma única instância de servidor e não foi projetado para distribuição horizontal sem estado compartilhado ou sticky session. A sessão é transitória e não sobrevive a restart.

Testes automatizados não substituem validação no BTV 11 real. QR/câmera, legibilidade à distância, foco por D-pad, overscan, contraste percebido, zoom de 200%, faixas extremas de viewport e comportamento do GeckoView ainda precisam ser conferidos em hardware/manual quando aplicável.
