# Controle remoto da TV pelo celular

O modo TV do Home Music permite usar um celular autenticado na **mesma conta** como controle remoto. A reprodução continua pertencendo ao player canônico da TV; a rota remota no celular não cria `<audio>` nem reproduz mídia localmente.

Quando a faixa escolhida já está baixada no celular, a mesma sessão pode estabelecer um DataChannel WebRTC e enviar os bytes diretamente para a TV antes do `play-track`. O backend continua apenas como fronteira de autenticação, ownership e sinalização. Detalhes: [`tv-offline-cast.md`](tv-offline-cast.md).

## Fluxo

1. Ao montar o modo TV, `useTvRemoteSession` prepara uma sessão efêmera em background e começa a publicar o estado do player.
2. O card **Controlar pelo celular** permanece disponível no topo direito.
3. Ao ativar o card, a TV exibe o QR abaixo dele, sem cobrir o gatilho.
4. O QR é gerado localmente no frontend; o endereço de pareamento não é enviado a serviço externo.
5. Se necessário, o celular autentica com a mesma conta e abre `/remote/<sessionId>`.
6. A validação da rota sinaliza `remote-connected` à TV; o QR é escondido quando o controlador realmente carrega, enquanto o card permanece visível.
7. O celular envia comandos ao servidor e a TV os recebe por SSE, aplicando-os ao player existente.
8. Em paralelo, celular e TV podem trocar offer/answer/ICE pela mesma sessão e abrir `home-music-media-v1` para mídia P2P.

A sessão preparada em background não significa que a interface de pareamento esteja aberta. Reabrir o card pode reapresentar o QR da sessão ativa; regenerar encerra a sessão anterior e cria outra.

## Protocolo

Os comandos atuais são:

- play/pause (`toggle-play`);
- faixa anterior (`previous`);
- próxima faixa (`next`);
- alternar aleatório (`toggle-shuffle`);
- alternar repetição (`cycle-repeat`);
- escolher uma faixa da biblioteca (`play-track`).

Os comandos legados de seek (`seek: -10` e `seek: +10`) continuam aceitos por compatibilidade, mas não fazem parte dos controles primários da interface atual do celular.

O snapshot publicado pela TV contém `trackId`, título, artista, estado de reprodução, posição, duração e `updatedAt`. Quando disponíveis, também inclui `shuffle` e `repeatMode`.

Eventos `signal` carregam somente sinalização WebRTC validada (`offer`, `answer` e ICE). Bytes de áudio não entram no SSE nem nas rotas REST.

No modo LAN, a mesma interface de sessão adapta o polling HTTP local. Após o DataChannel abrir, comandos, snapshots e mídia usam o peer comum. Frames textuais são versionados e deduplicados; mídia permanece em frames de controle próprios + chunks binários com backpressure.

## Presença e heartbeat

A TV publica mudanças materiais no máximo uma vez por segundo e também envia heartbeat periódico a cada 15 segundos. No servidor, a sessão expira quando a TV deixa de atualizar o heartbeat por 60 segundos.

No celular, `EventSource` aberto significa apenas que o controlador alcança o servidor. O rótulo **TV conectada** e a habilitação dos controles dependem também de um snapshot recente da TV. Depois de dois heartbeats perdidos (30 segundos sem snapshot recebido), a TV é tratada como desconectada até chegar nova atualização.

Há no máximo três sessões simultâneas por usuário; ao ultrapassar o limite, a mais antiga é encerrada. Reiniciar o processo do servidor invalida as sessões em memória.

## Segurança

- todos os endpoints exigem a autenticação normal do Home Music;
- a sessão pertence ao usuário que a criou;
- outro usuário recebe o mesmo `404` usado para sessão inexistente ou expirada;
- mutações usam `X-Home-Music-Request: 1` além do cookie same-origin;
- o identificador da sessão é opaco e aleatório;
- o QR é gerado no navegador e não usa serviço remoto;
- sinalização WebRTC possui validação e limites de tamanho;
- áudio P2P não passa pelo backend;
- cache offline permanece isolado pelo usuário autenticado no dispositivo;
- regenerar ou desmontar a TV tenta remover a sessão anterior no servidor;
- SSE, peer e DataChannel são encerrados no cleanup do frontend e no shutdown aplicável.

## Composição do frontend

`App.tsx` seleciona a superfície autenticada `/remote/<sessionId>` antes de `AuthenticatedApp`, impedindo que o celular inicialize o player online. `TvRemoteControlSurface` acrescenta apenas o peer/DataChannel e o preflight de faixas baixadas; a rota continua sem `<audio>` local.

Na TV, `AuthenticatedApp` continua dono de `useCrossfadeAudioPlayer`. `useTvRemoteSession` recebe o estado e callbacks canônicos de play/pause, anterior, próxima, seek legado, shuffle e repeat. Escolhas da biblioteca chegam como `play-track` e são encaminhadas ao mesmo player.

Quando uma faixa P2P foi recebida, ela é registrada como object URL transitório por `trackId`. O mesmo `useCrossfadeAudioPlayer` prefere essa fonte tanto na reprodução manual quanto no deck de entrada do crossfade, sem criar player paralelo.

A TV mostra **A SEGUIR** a partir da decisão canônica da fila, inclusive em shuffle e nos modos Repeat All/Repeat One.

## Foco e acessibilidade

A TV define o foco inicial ao montar a experiência, mas não o redefine em cada troca de faixa. Assim, autoplay, Next ou escolha remota não interrompem a navegação por D-pad.

No celular, entrar em **Biblioteca** move o foco para **Voltar ao controle**; voltar restaura o foco no gatilho da Biblioteca. Erros de seleção de faixa são exibidos junto à área da Biblioteca, próximos da ação que falhou. A transmissão P2P reutiliza o estado ocupado do item e exibe progresso em uma região `aria-live` separada.

A cor de destaque extraída da capa é normalizada para preservar contraste mínimo de 3:1 com os ícones brancos dos controles principais.

## Testes e CI

A cobertura inclui parser de rota, comandos e snapshots ampliados, presença remota, contrato compartilhado, contraste da paleta, adaptação dos comandos ao player, sinalização WebRTC, protocolo binário, limites, cache offline, object URLs e ordem `transferência -> play-track`.

O E2E `e2e/tests/tv-remote-control.spec.ts` usa dois contextos de navegador e valida, entre outros pontos:

- CTA e QR sem sobreposição;
- desaparecimento do QR quando o celular conecta;
- ausência de `<audio>` no celular;
- play/pause, próxima faixa, shuffle e repeat;
- `A SEGUIR` em Repeat One;
- preservação de foco da TV durante troca de faixa;
- transferência e restauração de foco ao entrar/sair da Biblioteca.

O E2E `e2e/tests/tv-offline-cast.spec.ts` salva uma faixa real no cache offline do celular, estabelece WebRTC entre os dois contexts, envia a faixa e confirma que a TV termina reproduzindo uma fonte `blob:` enquanto o celular permanece sem `<audio>`.

O CI executa esses cenários e o E2E `tv-offline-lan.spec.ts`, que bloqueia `/api/*` durante a sessão LAN e usa o receiver dedicado do APK.

## Limitações e validação física

O fluxo usa uma única instância de servidor e não foi projetado para distribuição horizontal sem estado compartilhado ou sticky session. A sessão é transitória e não sobrevive a restart.

O fluxo online de transmissão ainda usa o servidor para autenticação e sinalização. O modo LAN é uma ação explícita separada, exige PWA/downloads previamente instalados, mesma rede local e suporte do navegador a Local Network Access. TURN, redes diferentes e streaming progressivo permanecem fora de escopo.

Testes automatizados não substituem validação no BTV 11 real. QR/câmera, legibilidade à distância, foco por D-pad, overscan, WebRTC/DataChannel no GeckoView, consumo de memória e comportamento com perda de internet ainda precisam ser conferidos em hardware.
