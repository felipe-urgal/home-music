import { describe, expect, it } from 'vitest';
import { createNormalPlaybackSessionSnapshot } from './dj-session-policy';

describe('DJ normal playback session policy', () => {
  it('preserva faixa, posição, intenção de playback e deck ativo', () => {
    expect(createNormalPlaybackSessionSnapshot({
      trackId: 'track-1',
      currentTimeSeconds: 220.5,
      playing: true,
      activeDeck: 'b'
    })).toEqual({
      trackId: 'track-1',
      positionSeconds: 220.5,
      wasPlaying: true,
      activeDeck: 'b'
    });
  });

  it('normaliza posição inválida sem inventar playback', () => {
    expect(createNormalPlaybackSessionSnapshot({
      trackId: null,
      currentTimeSeconds: Number.NaN,
      playing: false,
      activeDeck: 'a'
    })).toEqual({
      trackId: null,
      positionSeconds: 0,
      wasPlaying: false,
      activeDeck: 'a'
    });

    expect(createNormalPlaybackSessionSnapshot({
      trackId: 'track-2',
      currentTimeSeconds: -5,
      playing: false,
      activeDeck: 'a'
    }).positionSeconds).toBe(0);
  });
});
