# PWA e modo offline

Este documento descreve o comportamento corrente da PWA do Home Music. Para detalhes de downloads, cache e regressões manuais, veja [`offline-downloads.md`](offline-downloads.md).

## App shell

O service worker mantém um shell público mínimo com HTML, assets compilados, manifest e ícones. O `OfflineApp` faz parte do bundle inicial, portanto um cold start sem rede não depende de carregar código adicional.

Quando o shell já está instalado, a aplicação consegue montar a interface a partir do conteúdo local e atualizar o shell depois, fora do caminho crítico de abertura.

### Atualização após deploy

O shell e os bundles compilados formam um snapshot coerente. Durante instalação ou atualização, o service worker baixa primeiro todos os assets com hash referenciados pelo HTML e só depois publica esse HTML como novo shell. Se qualquer bundle falhar, o último shell funcional permanece no cache.

Uma nova versão do cache estático força a recuperação de instalações antigas quando a política do shell muda. O worker atualizado usa ativação imediata e assume os clientes existentes, enquanto a limpeza de versões anteriores permanece restrita ao cache estático e ao cache de áudio legado. Os caches `home-music-offline-audio-v2-*` por usuário não são removidos por essa atualização.

## Bootstrap offline

A aplicação separa disponibilidade local de disponibilidade do servidor.

Quando o servidor não pode ser alcançado e existe uma identidade local conhecida com downloads registrados, `App.tsx` abre o `OfflineApp` pelo manifesto local e reconcilia os bytes físicos depois da montagem.

A reconciliação posterior remove itens realmente ausentes quando consegue verificar o Cache Storage. Uma falha transitória nessa verificação não transforma o manifesto em vazio nem impede a abertura inicial.

Uma resposta real do servidor continua tendo precedência sobre o modo offline; offline não substitui autenticação normal.

## Isolamento por usuário

Downloads, referências lógicas e cache de áudio continuam escopados ao usuário. Troca de conta não reutiliza silenciosamente conteúdo de outra identidade.

A reprodução offline continua usando a rota virtual `/offline-audio/<trackId>` servida pelo service worker para o contexto correto.

## Downloads

O frontend reutiliza um scheduler global com até três operações simultâneas para download individual, lote, playlists e pastas. A mesma faixa física pode servir várias referências lógicas sem duplicar os bytes.

Quando a plataforma oferece Background Fetch, uma transferência iniciada pode ser delegada ao navegador. Sem essa capacidade, o Home Music usa o fluxo foreground existente e não promete continuidade durante suspensão da página.

Detalhes: [`offline-downloads.md`](offline-downloads.md).

## Crossfade

O crossfade é uma preferência local do dispositivo e usa dois elementos de áudio somente durante a janela de transição. `useAudioPlayer` continua sendo a autoridade canônica de fila, faixa corrente, posição e persistência; ao concluir a mistura, o deck que já está tocando é adotado pelo player canônico em vez de reiniciar a próxima faixa.

Matriz corrente:

- Chromium mobile/Android com a aplicação em primeiro plano: crossfade disponível quando configurado;
- PWA instalada em Chromium/Android e online: usa a mesma composição da aplicação autenticada, portanto segue o mesmo comportamento em foreground;
- modo offline/PWA offline em foreground: reutiliza a mesma preferência de crossfade e carrega a próxima faixa pela rota virtual `/offline-audio/<trackId>`;
- iPhone/iPad, inclusive PWA WebKit: o crossfade permanece desativado por política de compatibilidade e a troca de faixa normal é preservada;
- segundo plano ou tela bloqueada: qualquer mistura em andamento é cancelada e o player degrada para a troca normal de faixa. No Apple mobile, o hardening específico de continuidade continua responsável pelo handoff próximo ao fim da música.

A suíte Playwright cobre o caminho real de dois decks no projeto `mobile-chromium` usando os WAVs locais do ambiente E2E. Instalação standalone real da PWA e comportamento com tela fisicamente bloqueada continuam sendo validações de plataforma/hardware; não devem ser declarados como executados sem evidência manual.

## Media Session

`useAudioPlayer` continua sendo a autoridade única de playback. Media Session apenas projeta a faixa corrente para os controles do sistema.

A metadata usa a capa efetiva quando existe e o fallback estático canônico quando não existe. Se a plataforma não aceitar artwork, o Home Music degrada para metadata textual sem quebrar reprodução.

A lock screen recebe representação estática; animação pertence ao player dentro da aplicação.

Detalhes: [`artwork-fallback.md`](artwork-fallback.md).

## Continuidade no iOS

O player possui hardening específico para Apple mobile sem criar um segundo player canônico: preparação de handoff, recuperação limitada de falhas transitórias, proteção contra ciclos de retry e diagnóstico local opt-in para eventos de playback/lifecycle.

Helpers de background podem observar e aplicar política, mas `useAudioPlayer` permanece a única fonte de verdade. O crossfade não é iniciado em Apple mobile WebKit; essa plataforma permanece no caminho de continuidade normal.

Detalhes: [`player-screen-responsibilities.md`](player-screen-responsibilities.md).

## Estado consolidado

As frentes abaixo foram incorporadas e encerradas:

- #325 — artwork canônica no Media Session;
- #327 — diagnóstico/hardening de continuidade com a tela bloqueada;
- #328 — cold start offline e redução do trabalho no caminho crítico.

Os QAs físicos residuais dessas issues foram dispensados como gate de encerramento por decisão do projeto e aceitos como risco de plataforma. Isso não significa que os testes em hardware tenham sido executados.

## Limites de plataforma

Recursos de PWA, armazenamento local, Media Session, background audio e Background Fetch variam entre navegadores e sistemas operacionais. O Home Music deve degradar de forma segura quando uma capacidade não estiver disponível.

Mudanças futuras nessas áreas devem usar a matriz de [`offline-downloads.md`](offline-downloads.md) como protocolo de regressão e abrir uma nova issue quando houver evidência de comportamento específico de plataforma.
