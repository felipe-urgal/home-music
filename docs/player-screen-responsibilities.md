# Responsabilidades da PlayerScreen

A `PlayerScreen` é a composição visual do player mobile/tablet. Ela não é dona do estado de reprodução: fila, faixa atual, posição, playing, volume, shuffle, repeat, persistência e retomada continuam centralizados em `useAudioPlayer`.

## Limites

- `PlayerTrackPresentation`: topbar, artwork, metadata e ações da faixa, incluindo playlist/download e estado offline.
- `PlayerPlaybackControls`: progresso/seek, play/pause, anterior/próxima, shuffle, repeat e volume.
- `LyricsPanel`: apresentação e sincronização visual de letras.
- `PlayerQueuePanel`: expansão da fila, paginação visual, drag desktop/touch e comandos de reordenação.
- `PlayerScreen`: orquestra essas superfícies por props, sem `useState`, `useRef` ou `useEffect` próprios.
- `useAudioPlayer`: fonte única de verdade para playback e persistência do estado do player.

## Estado local permitido

Os componentes visuais podem manter somente estado transitório de interface, por exemplo:

- picker de playlist aberto/fechado;
- fila expandida/recolhida;
- quantidade de itens visíveis da fila;
- índice visual de drag enquanto uma reordenação acontece.

Esse estado não pode substituir nem espelhar `playing`, posição, fila canônica, faixa atual, volume, shuffle ou repeat.

## Desktop e continuidade

O desktop e o mobile continuam recebendo o mesmo estado/callbacks originados de `useAudioPlayer`. O refactor não cria um segundo player e não altera o elemento `<audio>`, Media Session, continuidade em background, preload ou persistência/retomada.

## Regressões relevantes

Mudanças futuras nessas superfícies devem preservar:

- seek e posição restaurada;
- shuffle e repeat;
- anterior/próxima;
- reordenação e persistência da fila;
- retomada de playback quando permitida pelo navegador;
- comportamento offline e download;
- mesma fonte de estado para mobile e desktop.

Este desenho registra o refactor comportamentalmente neutro da issue #114.
