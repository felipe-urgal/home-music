import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { resolveManualCrossfadeCandidate } from './crossfade';
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

  it('libera troca manual com crossfade apenas enquanto a faixa atual está tocando em foreground', () => {
    expect(resolveManualCrossfadeCandidate({
      currentTrackId: 'a',
      targetTrackId: 'b',
      durationSeconds: 3,
      playing: true,
      visibilityState: 'visible'
    })).toEqual({ trackId: 'b', durationSeconds: 3 });

    expect(resolveManualCrossfadeCandidate({
      currentTrackId: 'a',
      targetTrackId: 'b',
      durationSeconds: 3,
      playing: false,
      visibilityState: 'visible'
    })).toBeNull();

    expect(resolveManualCrossfadeCandidate({
      currentTrackId: 'a',
      targetTrackId: 'b',
      durationSeconds: 0,
      playing: true,
      visibilityState: 'visible'
    })).toBeNull();

    expect(resolveManualCrossfadeCandidate({
      currentTrackId: 'a',
      targetTrackId: 'a',
      durationSeconds: 3,
      playing: true,
      visibilityState: 'visible'
    })).toBeNull();
  });
});
