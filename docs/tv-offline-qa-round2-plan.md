# TV offline QA — rodada 2

Status: **em andamento**  
Branch: `fix/tv-offline-qa-round2`  
Base: `main` pós-merge do PR #426

## Objetivo

Fechar os pontos encontrados no QA físico do fluxo offline iPhone → bridge LAN → WebRTC/DataChannel → BTV, sem regredir o caminho LAN direto de Android/desktop e deixando o comportamento de queda/repareamento explícito e testável.

## Evidência física já obtida em 17/09/2026

O teste real confirmou que o fluxo principal funciona em hardware real:

- iPhone abre o bridge HTTP local a partir do Home Music em HTTPS;
- o pareamento chega até WebRTC/DataChannel;
- música baixada no iPhone é enviada diretamente para a BTV sem depender do backend/WAN;
- a BTV reproduz a mídia recebida.

Também foi observado um problema ainda não fechado:

- depois de a conexão P2P estar funcional, houve uma queda posterior do vínculo;
- a condição exata que dispara essa queda ainda não foi identificada;
- portanto, estabilidade e recuperação não devem ser consideradas concluídas até existir cobertura automatizada e novo QA físico.

## Restrições que devem ser preservadas

- manter `home-music-lan-remote-v2` como protocolo LAN;
- WebRTC/DataChannel continuam sendo o canal de mídia e controles;
- o bridge HTTP continua apenas como adaptador de signaling para iOS;
- o `secret` do QR permanece no PWA e não deve ser exposto/persistido pelo bridge;
- Android/desktop continuam usando o transporte LAN direto;
- não adicionar fallback silencioso que mascare falha de pareamento;
- queda de P2P não pode deixar a UI em falso estado de conectado;
- uma sessão expirada, regenerada ou encerrada não deve ser reutilizada;
- o celular não deve iniciar reprodução local quando a TV estiver ativa.

## Plano de implementação

### 1. Estabilidade do P2P e recuperação segura

Arquivos principais esperados:

- `apps/web/src/tv-remote-peer.ts`;
- `apps/web/src/tv-remote-data-channel.ts`;
- `apps/web/src/tv-lan-remote-client.ts`;
- `apps/web/src/tv-lan-receiver-client.ts`;
- `apps/web/src/OfflineApp.tsx`;
- `apps/web/src/TvOfflineReceiver.tsx`;
- testes unitários correspondentes.

Checklist:

- [ ] cobrir transições `connecting → open → closed/error` do peer/DataChannel;
- [ ] diferenciar encerramento voluntário de queda inesperada;
- [ ] limpar timers, listeners, polling, transport e referências da tentativa anterior;
- [ ] remover imediatamente o estado de TV conectada quando o P2P deixa de estar utilizável;
- [ ] mostrar mensagem clara de conexão perdida no iPhone e na TV;
- [ ] garantir que comandos/envio de mídia não sejam aceitos por um canal já encerrado;
- [ ] definir recuperação segura por novo pareamento/QR quando necessário;
- [ ] se o receiver conseguir gerar novo pareamento sem recarregar a tela, reutilizar esse fluxo; caso contrário, tornar a necessidade de reabrir/recarregar explícita;
- [ ] preservar invalidação de QR antigo e regras de TTL/replay;
- [ ] adicionar testes para queda durante idle, comando e envio de mídia, sempre que reproduzível em teste automatizado.

Critério de aceite:

- após perda real do P2P, ambos os lados saem de `connected`, nenhum comando continua sendo enviado em canal morto e o usuário recebe um caminho claro para parear novamente sem reutilizar a sessão antiga.

### 2. Navegação das coleções offline

Arquivos principais esperados:

- `apps/web/src/OfflineApp.tsx`;
- `apps/web/src/components/OfflineLibraryScreen.tsx`;
- CSS/testes da biblioteca offline.

Estado atual relevante: a tela lista coleções offline, mas o clique principal já inicia a primeira faixa disponível. A rodada 2 deve permitir abrir a coleção e navegar pelo conteúdo antes de escolher a música.

Checklist:

- [ ] abrir uma coleção offline sem iniciar reprodução automaticamente;
- [ ] listar somente as músicas disponíveis localmente naquela coleção;
- [ ] permitir voltar para a lista de coleções sem perder o estado da sessão da TV;
- [ ] tocar/enviar uma faixa escolhida usando a coleção aberta como contexto/fila;
- [ ] tratar coleção parcial, vazia e registro ausente sem ação inválida;
- [ ] preservar downloads individuais e ações de remoção existentes;
- [ ] manter o fluxo funcional sem backend/WAN.

Critério de aceite:

- o usuário consegue entrar em uma coleção offline, escolher uma faixa específica e voltar à biblioteca, tanto para reprodução local quanto para envio à TV.

### 3. Limpeza do banner/estado de controle remoto

Arquivos principais esperados:

- `apps/web/src/components/OfflineLibraryScreen.tsx`;
- `apps/web/src/OfflineApp.tsx`;
- CSS relacionado.

Checklist:

- [ ] remover o banner persistente `Downloads no celular`/mensagem equivalente que ocupa espaço depois que a TV já está ativa;
- [ ] manter somente status útil e contextual para conectar, conectando, enviando, desconectado ou erro;
- [ ] preservar uma ação clara para conectar/desconectar a TV;
- [ ] não esconder erros de sessão atrás de mensagens genéricas.

Critério de aceite:

- a biblioteca offline deixa de ter um aviso permanente redundante, mas continua mostrando estado e ação quando isso ajuda o usuário.

### 4. Instruções e UX do bridge iOS

Arquivos principais esperados:

- `android-tv/app/src/main/assets/bridge.html`;
- `android-tv/app/src/main/assets/bridge.js`;
- `apps/web/src/TvLanQrScanner.tsx`;
- testes do bridge.

Checklist:

- [ ] trocar a tela mínima do bridge por instruções curtas e acionáveis;
- [ ] distinguir inicialização, aguardando Home Music, pareando, P2P pronto, erro e sessão expirada/encerrada;
- [ ] orientar o usuário a voltar ao Home Music quando o bridge tiver cumprido seu papel;
- [ ] manter fallback manual quando `window.close()` for bloqueado;
- [ ] nunca exibir `secret`, proof ou autorização;
- [ ] preservar validação estrita de `origin`, `source`, `channelId` e allowlist existente.

Critério de aceite:

- no iPhone, a aba do bridge deixa claro o que está acontecendo e o que o usuário deve fazer sem expor material sensível.

### 5. Cobertura automatizada

Testes a revisar/estender:

- unitários de `tv-remote-peer` e `tv-remote-data-channel`;
- unitários de `tv-lan-remote-client`/`tv-lan-receiver-client`;
- testes de `OfflineApp`/`OfflineLibraryScreen`;
- `e2e/tests/tv-offline-lan-bridge.spec.ts`;
- E2E LAN/offline existentes que compartilham o fluxo.

Checklist:

- [ ] escrever primeiro os testes que reproduzem cada comportamento novo/corrigido;
- [ ] cobrir fechamento inesperado do DataChannel/peer e cleanup;
- [ ] cobrir repareamento após perda sem reuso da sessão antiga;
- [ ] cobrir navegação de coleção offline e escolha de faixa;
- [ ] cobrir estados úteis do bridge;
- [ ] manter o E2E iOS bridge e o E2E LAN direto verdes;
- [ ] rodar CI completo no head final;
- [ ] rodar workflow Android TV no mesmo head final e validar APK/assets.

Nenhum gate será marcado como concluído apenas por histórico de um commit anterior; a evidência precisa ser do head final do PR.

### 6. QA físico obrigatório — iPhone + BTV

Pré-condições:

- APK gerado do mesmo head final do PR;
- Home Music/PWA do mesmo head disponível em HTTPS no iPhone;
- pelo menos duas faixas baixadas;
- iPhone e BTV na mesma LAN;
- teste principal com backend/WAN desligados.

Checklist:

- [ ] cold start da BTV em modo offline;
- [ ] cold start do PWA no iPhone;
- [ ] navegar por uma coleção offline e escolher uma faixa específica;
- [ ] parear via bridge;
- [ ] confirmar DataChannel aberto;
- [ ] enviar e reproduzir faixa A;
- [ ] pause/play, seek, next e previous;
- [ ] enviar/reproduzir faixa B;
- [ ] deixar a sessão ativa por tempo suficiente para tentar reproduzir a queda observada anteriormente;
- [ ] interromper Wi‑Fi durante signaling e confirmar recuperação/erro claro;
- [ ] interromper Wi‑Fi depois do P2P aberto e confirmar detecção de queda;
- [ ] parear novamente usando QR novo após a queda;
- [ ] confirmar que QR antigo não volta a funcionar;
- [ ] background/foreground do iPhone durante signaling e depois do P2P;
- [ ] validar auto-close do bridge e fallback manual;
- [ ] religar backend/WAN e confirmar que o modo online continua íntegro.

Registrar no PR/docs:

- modelo do iPhone;
- versão do iOS;
- versão do browser/PWA;
- firmware/Android da BTV;
- versão/commit do APK;
- comportamento do popup/aba bridge;
- resultado de queda/repareamento;
- playback e controles;
- qualquer erro reproduzível.

### 7. Documentação final

Atualizar somente com fatos efetivamente validados:

- [ ] `docs/tv-offline-lan-protocol.md`;
- [ ] `docs/tv-offline-cast.md`;
- [ ] `docs/tv-remote-control.md`;
- [ ] `docs/android-tv.md`;
- [ ] `android-tv/README.md`;
- [ ] `docs/ios-lan-bridge-production-plan.md`;
- [ ] `e2e/README.md`, se o procedimento automatizado mudar;
- [ ] matriz real de compatibilidade iOS/BTV;
- [ ] limitações e procedimento de recuperação após perda de P2P;
- [ ] decidir se `docs/spikes/ios-lan-bridge-probe.html` ainda tem valor diagnóstico ou deve ser removido.

## Ordem prevista de commits

1. `docs: plan TV offline QA round 2`;
2. testes + correção de estabilidade/recuperação P2P;
3. testes + navegação das coleções offline;
4. limpeza do estado/banner e UX do bridge;
5. E2E/regressões e documentação técnica;
6. registro do QA físico final.

## Definição de pronto

O PR só deve sair de draft quando todos estes pontos forem verdadeiros:

- [ ] queda do P2P é detectada de forma confiável e não deixa falso estado conectado;
- [ ] novo pareamento após queda usa sessão/QR novos e funciona em hardware real;
- [ ] navegação de coleções offline funciona sem backend;
- [ ] banner redundante foi removido e os estados continuam claros;
- [ ] bridge iOS possui instruções úteis e lifecycle validado;
- [ ] testes unitários/E2E relevantes estão verdes;
- [ ] CI completo e Android TV estão verdes no mesmo head final;
- [ ] QA físico iPhone + BTV foi repetido e registrado;
- [ ] documentação canônica reflete exatamente o comportamento validado.
