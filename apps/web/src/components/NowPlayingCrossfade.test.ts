import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import type { CrossfadeVisualState } from '../crossfade-visual';
import { crossfadePresentationProgress } from './NowPlayingCrossfade';

const incomingTrack: Track = {
  id: 'track-2',
  title: 'Próxima faixa',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista',
  folder: 'Álbum',
  folderPath: 'Artista/Álbum',
  duration: 180,
  format: 'flac',
  hasCover: true
};

function visualState(elapsedSeconds: number, durationSeconds = 5): CrossfadeVisualState {
  return {
    attempt: 1,
    originTrackId: 'track-1',
    incomingTrack,
    durationSeconds,
    elapsedSeconds
  };
}

describe('crossfadePresentationProgress', () => {
  it('preserva o progresso completo do crossfade quando não há janela visual', () => {
    expect(crossfadePresentationProgress(visualState(2.5))).toBe(0.5);
  });

  it('mantém a faixa atual estável até a janela visual curta no fim do crossfade', () => {
    expect(crossfadePresentationProgress(visualState(4), 0.5)).toBe(0);
    expect(crossfadePresentationProgress(visualState(4.75), 0.5)).toBe(0.5);
    expect(crossfadePresentationProgress(visualState(5), 0.5)).toBe(1);
  });

  it('limita a janela visual à duração real quando o crossfade de áudio é mais curto', () => {
    expect(crossfadePresentationProgress(visualState(0.1, 0.2), 0.5)).toBeCloseTo(0.5);
  });
});
