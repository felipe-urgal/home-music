import { describe, expect, it } from 'vitest';
import type { LyricsResponse } from '@home-music/shared';
import { currentLyricsLineText, findActiveLyricsLineIndex } from './LyricsPanel';

const synchronizedLyrics: LyricsResponse = {
  source: 'lrc',
  synchronized: true,
  lines: [
    { time: 0, text: 'Primeira linha' },
    { time: 3, text: 'Segunda linha' },
    { time: 6, text: 'Terceira linha' }
  ]
};

describe('acompanhamento de letra sincronizada', () => {
  it('seleciona a última linha cujo tempo já foi alcançado', () => {
    expect(findActiveLyricsLineIndex(synchronizedLyrics, 3.1)).toBe(1);
  });

  it('expõe somente o texto da linha sincronizada atual', () => {
    expect(currentLyricsLineText(synchronizedLyrics, 3.1)).toBe('Segunda linha');
  });

  it('não exibe linha atual para letra sem sincronização', () => {
    expect(currentLyricsLineText({
      ...synchronizedLyrics,
      synchronized: false
    }, 3.1)).toBeNull();
  });
});
