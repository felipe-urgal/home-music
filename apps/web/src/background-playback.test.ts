import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import {
  BACKGROUND_HANDOFF_WINDOW_SECONDS,
  configurePlaybackAudioSession,
  isAppleMobileWebKit,
  resolveBackgroundAutoAdvance
} from './background-playback';

function track(id: string): Track {
  return {
    id,
    title: id,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Pasta',
    folderPath: '',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null
  };
}

describe('background playback', () => {
  const queue = [track('a'), track('b')];

  it('detecta iPhone/iPad inclusive quando iPadOS se identifica como Mac', () => {
    expect(isAppleMobileWebKit({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X)' })).toBe(true);
    expect(isAppleMobileWebKit({ platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true);
    expect(isAppleMobileWebKit({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' })).toBe(false);
  });

  it('configura audioSession como playback quando a API existe', () => {
    const audioSession = { type: 'ambient' };
    expect(configurePlaybackAudioSession({ audioSession })).toBe(true);
    expect(audioSession.type).toBe('playback');
    expect(configurePlaybackAudioSession({})).toBe(false);
  });

  it('antecipa somente a próxima faixa perto do fim e em background', () => {
    const currentTime = 180 - BACKGROUND_HANDOFF_WINDOW_SECONDS / 2;
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', currentTime, 180, true, true)).toBe('b');
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', currentTime, 180, false, true)).toBeNull();
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', currentTime, 180, true, false)).toBeNull();
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', 170, 180, true, true)).toBeNull();
  });

  it('respeita repeat all, repeat one e fim da fila', () => {
    const nearEnd = 179.8;
    expect(resolveBackgroundAutoAdvance(queue, 1, 'all', nearEnd, 180, true, true)).toBe('a');
    expect(resolveBackgroundAutoAdvance(queue, 0, 'one', nearEnd, 180, true, true)).toBeNull();
    expect(resolveBackgroundAutoAdvance(queue, 1, 'off', nearEnd, 180, true, true)).toBeNull();
  });

  it('rejeita duração e posição inválidas', () => {
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', Number.NaN, 180, true, true)).toBeNull();
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', 179.9, Number.POSITIVE_INFINITY, true, true)).toBeNull();
    expect(resolveBackgroundAutoAdvance(queue, 0, 'off', 180, 180, true, true)).toBeNull();
  });
});
