# Controle remoto da TV pelo celular

O modo TV do Home Music permite usar um celular autenticado na **mesma conta** como controle remoto da reprodução. A reprodução continua pertencendo ao player canônico da TV; a tela aberta no celular não cria `<audio>` nem reproduz mídia localmente.

## Fluxo

1. Na TV, abra **Controle pelo celular** na barra superior.
2. A TV cria uma sessão efêmera no servidor e começa a publicar o snapshot do player.
3. Escaneie o QR code exibido. O QR é gerado localmente pelo frontend; nenhum endereço de pareamento é enviado a serviço externo.
4. Se necessário, faça login no celular com a mesma conta usada na TV.
5. A rota `/remote/<sessionId>` valida a sessão e abre o controlador.
6. O celular envia comandos ao servidor; a TV recebe os comandos por SSE e os aplica ao player existente.

O endereço textual permanece visível como fallback. **Gerar novo código** encerra a sessão anterior e cria outra.

## Comandos do MVP

O protocolo aceita somente:

- play/pause (`toggle-play`);
- faixa anterior (`previous`);
- próxima faixa (`next`);
- retroceder 10 segundos (`seek: -10`);
- avançar 10 segundos (`seek: +10`).

Seek remoto usa a posição mais recente do player da TV e é limitado ao intervalo válido da faixa.

## Estado e heartbeat

A TV publica título, artista, estado de reprodução, posição e duração. Mudanças materiais são limitadas a no máximo uma publicação por segundo e existe heartbeat periódico de até 15 segundos.

No servidor, a sessão é mantida em memória e expira quando a TV deixa de atualizar o heartbeat por 60 segundos. Há no máximo três sessões simultâneas por usuário; ao ultrapassar o limite, a mais antiga é encerrada. Reiniciar o processo do servidor invalida as sessões existentes.

## Segurança

- todos os endpoints exigem a autenticação normal do Home Music;
- a sessão pertence ao usuário que a criou;
- outro usuário recebe o mesmo `404` usado para sessão inexistente/expirada, evitando revelar ownership;
- mutações usam `X-Home-Music-Request: 1` além do cookie same-origin;
- o identificador da sessão é opaco e aleatório;
- o QR é gerado no navegador e não usa serviço remoto;
- fechar, regenerar ou desmontar a sessão tenta removê-la no servidor;
- SSE é encerrado no cleanup do frontend e no shutdown do servidor.

## Composição do frontend

`App.tsx` mantém a autoridade de autenticação/offline. Somente depois de confirmar uma sessão autenticada ele seleciona a superfície `/remote/<sessionId>` e renderiza `TvRemoteControlScreen` **antes** de `AuthenticatedApp`. Isso impede que o celular instancie o player online.

Na TV, `AuthenticatedApp` continua sendo dono de `useCrossfadeAudioPlayer`. `useTvRemoteSession` recebe apenas o estado e os callbacks canônicos do player; nenhum estado paralelo de reprodução é criado. O botão de pareamento é inserido na topbar do modo TV e participa da navegação por D-pad.

## Servidor

`TvRemoteSessionManager` é process-local e pertence ao composition root do servidor. `registerTvRemoteRoutes` expõe create/get/status/command/delete e o stream SSE. O manager é encerrado no hook `onClose`, liberando timers e assinaturas.

## Testes e CI

A cobertura inclui testes de contrato do cliente HTTP/SSE, parser de rota, adaptação dos comandos, normalização/seek da TV e geração local do QR.

O E2E `e2e/tests/tv-remote-control.spec.ts` usa dois contextos de navegador contra o servidor descartável real. Ele prova que o celular não possui `<audio>` e que play/pause, próxima e seek modificam a UI da TV.

O CI executa o **TV remote control E2E** depois do Mobile crossfade E2E e antes dos demais E2Es direcionados.

## Limitações e validação física

O fluxo usa uma única instância de servidor e não foi projetado para distribuição horizontal sem sticky/shared state. A sessão é transitória e não sobrevive a restart.

A existência de testes automatizados não substitui validação no BTV 11 real. QR/câmera, legibilidade a distância, foco por D-pad, overscan e comportamento do GeckoView ainda devem ser conferidos em hardware conforme a issue de TV; esta documentação não declara essa validação física como concluída.
