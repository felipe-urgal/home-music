# Responsabilidades da PlayerScreen

A `PlayerScreen` é a composição visual do player mobile/tablet. Ela não é dona do estado de reprodução: fila, faixa atual, posição, playing, volume, shuffle, repeat, persistência e retomada continuam centralizados em `useAudioPlayer`.

## Limites

- `PlayerTrackPresentation`: topbar, artwork, metadata e ações da faixa, incluindo playlist/download e estado offline.
- `PlayerPlaybackControls`: progresso/seek, play/pause, anterior/próxima, shuffle, repeat e volume.
- `LyricsPanel`: apresentação e sincronização visual de letras.
- `PlayerQueuePanel`: expansão da fila, paginação visual, drag desktop/touch e comandos de reordenação.
- `PlayerScreen`: orquestra essas superfícies por props, sem `useState`, `useRef` ou `useEffect` próprios.
- `useAudioPlayer`: fonte única de verdade para playback, tratamento de erro de mídia e persistência do estado do player.

## Estado local permitido

Os componentes visuais podem manter somente estado transitório de interface, por exemplo:

- picker de playlist aberto/fechado;
- fila expandida/recolhida;
- quantidade de itens visíveis da fila;
- índice visual de drag enquanto uma reordenação acontece.

Esse estado não pode substituir nem espelhar `playing`, posição, fila canônica, faixa atual, volume, shuffle ou repeat.

## Desktop e continuidade

O desktop e o mobile continuam recebendo o mesmo estado/callbacks originados de `useAudioPlayer`. O refactor não cria um segundo player e não altera o elemento `<audio>`, Media Session, continuidade em background, preload ou persistência/retomada.

Durante reprodução contínua, uma falha definitiva de mídia só é considerada depois dos fallbacks já suportados pelo player. Se ainda existir intenção de reprodução, a faixa com erro é ignorada e a fila avança automaticamente para a próxima opção. Falhas consecutivas continuam avançando sem loop infinito; `repeat one` não repete uma faixa quebrada, e `repeat all` só faz wrap enquanto existir outra faixa ainda não tentada naquele ciclo de erro. Bloqueio de autoplay do navegador continua sendo tratado separadamente e não faz o player pular músicas.

No Apple mobile WebKit existe uma exceção de plataforma para erro transitório em background. `MEDIA_ERR_NETWORK` — ou evento sem código — enquanto o documento está oculto recebe no máximo uma tentativa de recuperação da mesma fonte. Se a recuperação falhar novamente sem progresso real, o player encerra a intenção de reprodução de forma estável em vez de percorrer a fila inteira com novas sequências de `src/load/play`. Erros definitivos de decode/formato continuam seguindo os fallbacks e o skip automático normal.

Um avanço normal da fila — manual, `ended` ou handoff antecipado do iOS — encerra qualquer ciclo anterior de faixas falhas. Isso é evidência de continuidade válida e evita depender exclusivamente de `timeupdate`, que pode ser reduzido pelo WebKit em background.

## Regressões relevantes

Mudanças futuras nessas superfícies devem preservar:

- seek e posição restaurada;
- shuffle e repeat;
- anterior/próxima;
- reordenação e persistência da fila;
- retomada de playback quando permitida pelo navegador;
- avanço automático após erro definitivo de uma faixa, sem loop em falhas consecutivas;
- recuperação limitada de erro transitório do Apple mobile em background, sem cascata de fontes;
- reset do ciclo de falhas após avanço normal mesmo sem `timeupdate`;
- comportamento offline e download;
- mesma fonte de estado para mobile e desktop.

Este desenho registra o refactor comportamentalmente neutro da issue #114, o tratamento de continuidade de reprodução da issue #254 e a regressão específica de background da issue #255.
