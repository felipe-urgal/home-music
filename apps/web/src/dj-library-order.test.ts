import { describe, expect, it } from 'vitest';
import { movePlayedDjTracksToEnd } from './dj-library-order';

describe('DJ library order', () => {
  const tracks = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
    { id: 'c', title: 'C' },
    { id: 'd', title: 'D' },
    { id: 'e', title: 'E' }
  ];

  it('move faixas tocadas para o final preservando a ordem dos dois grupos', () => {
    expect(movePlayedDjTracksToEnd(tracks, new Set(['b', 'd'])).map(track => track.id))
      .toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('mantém a ordem quando nenhuma faixa foi tocada', () => {
    expect(movePlayedDjTracksToEnd(tracks, new Set()).map(track => track.id))
      .toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('mantém a ordem relativa quando todas já foram tocadas', () => {
    expect(movePlayedDjTracksToEnd(tracks, new Set(['a', 'b', 'c', 'd', 'e'])).map(track => track.id))
      .toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('ignora IDs tocados que não pertencem à origem atual', () => {
    expect(movePlayedDjTracksToEnd(tracks, new Set(['x', 'c'])).map(track => track.id))
      .toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('não altera a lista de origem', () => {
    const source = [...tracks];
    movePlayedDjTracksToEnd(source, new Set(['a']));
    expect(source.map(track => track.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
