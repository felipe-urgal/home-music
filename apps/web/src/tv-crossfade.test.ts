import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import type { CrossfadeVisualState } from './crossfade-visual';
import { resolveTvCrossfadePresentation } from './tv-crossfade';

function track(id: string, title: string): Track {
  return { id, title, artist: `Artista ${id}` } as Track;
}

describe('tv crossfade presentation', () => {
  it('faz a capa e a identidade da faixa atual cederem espaço à próxima na mesma proporção do áudio', () => {
    const current = track('a', 'Faixa A');
    const incoming = track('b', 'Faixa B');
    const crossfade: CrossfadeVisualState = {
      attempt: 1,
      originTrackId: current.id,
      incomingTrack: incoming,
      durationSeconds: 20,
      elapsedSeconds: 5
    };

    expect(resolveTvCrossfadePresentation(current, crossfade)).toEqual({
      incomingTrack: incoming,
      progress: 0.25,
      outgoingOpacity: 0.75,
      incomingOpacity: 0.25
    });
  });

  it('mantém somente a faixa atual quando não existe crossfade ativo para ela', () => {
    const current = track('a', 'Faixa A');
    const incoming = track('b', 'Faixa B');
    const unrelated: CrossfadeVisualState = {
      attempt: 2,
      originTrackId: 'outra-faixa',
      incomingTrack: incoming,
      durationSeconds: 10,
      elapsedSeconds: 5
    };

    expect(resolveTvCrossfadePresentation(current, unrelated)).toEqual({
      incomingTrack: null,
      progress: null,
      outgoingOpacity: 1,
      incomingOpacity: 0
    });
  });
});
