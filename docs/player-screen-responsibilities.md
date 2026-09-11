# Responsabilidades da PlayerScreen e continuidade de playback

A `PlayerScreen` é a composição visual do player mobile/tablet. Ela não é dona do estado de reprodução: fila, faixa atual, posição, playing, volume, shuffle, repeat, persistência e retomada continuam centralizados em `useAudioPlayer`.

## Limites de responsabilidade

- `PlayerTrackPresentation`: topbar, artwork, metadata e ações da faixa;
- `PlayerPlaybackControls`: progresso/seek, play/pause, anterior/próxima, shuffle, repeat e volume;
- `LyricsPanel`: apresentação e sincronização visual de letras;
- `PlayerQueuePanel`: expansão, paginação visual e reordenação da fila;
- `PlayerScreen`: compõe essas superfícies por props;
- `useAudioPlayer`: fonte única de verdade para playback, erros de mídia e persistência.

Estado local de UI não pode substituir ou espelhar a fila canônica, faixa atual, `playing`, posição, volume, shuffle ou repeat.

## Desktop, mobile e offline

Desktop e mobile recebem o mesmo estado/callbacks originados de `useAudioPlayer`. O modo offline usa uma instância própria apenas porque opera sobre outra coleção/persistência, mas dentro de cada modo continua existindo uma única autoridade de playback.

Media Session, preload, continuidade em background e helpers de diagnóstico não são players paralelos.

## Transição contínua em foreground

A reprodução online autenticada pode envolver `useAudioPlayer` com `useCrossfadeAudioPlayer` para oferecer uma transição opcional entre faixas sem deslocar a autoridade do player.

A preferência é local ao dispositivo e configurada em segundos:

- `0 s`: comportamento canônico sem sobreposição;
- `1–30 s`: duração da mistura entre o fim da faixa atual e o começo da próxima;
- preferências antigas `soft` e `continuous` são migradas para `3 s` e `5 s` respectivamente.

Quando o crossfade está ativo, dois elementos de áudio funcionam como decks A/B. O deck que entra durante a transição continua sendo a própria fonte audível depois que a faixa anterior termina. Antes de avançar a faixa canônica, o wrapper registra esse deck no `useAudioPlayer` como uma fonte já carregada; ao receber o novo `currentTrackId`, o player adota a fonte e a posição correntes sem reatribuir `src`, chamar `load()` ou voltar para `0 s`.

A fila, a decisão de próxima faixa, shuffle, repeat, persistência e Media Session continuam pertencendo ao `useAudioPlayer` principal. Os decks são recursos de reprodução, não fontes paralelas de estado.

Regras de segurança da transição:

- só inicia com `document.visibilityState === 'visible'`;
- Apple mobile WebKit (iPhone/iPad) permanece no fluxo canônico de um único elemento de áudio;
- `repeat one` não cria um segundo stream concorrente da mesma faixa;
- ações manuais de next/previous/seek, mudanças de shuffle/repeat, troca de qualidade/normalização e seleção de outra música cancelam a mistura;
- se o deck de entrada falhar ou não puder iniciar, o volume do deck ativo é restaurado e o avanço normal assume a fila;
- o fade usa curva de potência equivalente: a faixa atual reduz progressivamente enquanto a próxima aumenta progressivamente, evitando queda perceptível de volume no meio da mistura;
- ao concluir a transição, o deck de entrada é promovido sem interromper ou reiniciar a música que já está tocando;
- ao ir para background/tela bloqueada, qualquer sobreposição é descartada e o fluxo existente de um único player permanece ativo;
- o modo offline continua usando diretamente `useAudioPlayer`, sem crossfade.

## Erros de mídia

Falha definitiva de uma faixa é tratada somente depois dos fallbacks suportados. Quando a intenção de reprodução continua válida, o player pode avançar para a próxima faixa sem criar loop infinito.

Regras importantes:

- bloqueio de autoplay não é tratado como mídia quebrada;
- `repeat one` não deve prender o player em faixa definitivamente inválida;
- ciclos de erro precisam terminar quando não restar alternativa segura;
- um avanço normal da fila encerra o ciclo anterior de falhas.

## Apple mobile e background

Em Apple mobile existe tratamento específico para falhas transitórias em background.

A política atual preserva:

- tentativa limitada de recuperação da mesma fonte;
- nenhuma cascata infinita de `src/load/play` pela fila;
- handoff/preload como otimização, sem segunda fonte de verdade;
- revalidação de `audioSession` quando a plataforma expõe essa capacidade;
- controles de Media Session delegando para a mesma autoridade de playback.

Se a plataforma suspender o pipeline e não permitir ação em background, o Home Music não tenta contornar o sistema operacional com áudio silencioso, timers agressivos ou retry infinito.

## Diagnóstico local

A frente #327 adicionou instrumentação local opt-in para distinguir eventos do elemento de áudio, lifecycle da página, handoff, estado de intenção e ações originadas pela Media Session.

O diagnóstico deve permanecer limitado e local. Ele não vira telemetria obrigatória nem uma segunda máquina de estados.

Quando usado, não deve registrar dados desnecessários da mídia ou credenciais.

## Media Session

Play/pause/next/previous do sistema continuam usando `useAudioPlayer`. Artwork e metadata são projeções derivadas da faixa corrente; detalhes de imagem ficam em [`artwork-fallback.md`](artwork-fallback.md).

Falha ou ausência de Media Session não deve quebrar o player foreground.

## Estado da #327

A implementação de diagnóstico/hardening foi incorporada e a issue #327 foi encerrada. O QA físico residual em iPhone/PWA foi dispensado como gate por decisão do projeto e aceito como risco de plataforma.

Isso não significa que os cenários físicos tenham sido executados. Caso um problema volte a ser observado em hardware real, ele deve ser registrado em nova issue com modelo do aparelho, versão do sistema e momento da interrupção.

## Regressões relevantes

Mudanças futuras devem preservar:

- seek e posição restaurada;
- shuffle/repeat e anterior/próxima;
- reordenação/persistência da fila;
- mesma autoridade de estado em mobile/desktop;
- avanço seguro após erro definitivo;
- recuperação limitada para erro transitório de background;
- ausência de retry infinito/cascata de fontes;
- controles de Media Session ligados ao mesmo player;
- comportamento offline;
- degradação segura quando a plataforma limita background audio.
