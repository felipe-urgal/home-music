import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { publishMediaSessionMetadata } from './media-session-artwork';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1',
    title: 'Águas de Março',
    artist: 'Elis Regina',
    album: 'Elis & Tom',
    albumArtist: 'Elis Regina & Tom Jobim',
    folder: 'MPB',
    folderPath: 'MPB',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    ...overrides
  };
}

describe('publishMediaSessionMetadata', () => {
  it('publica metadata e artwork juntas', () => {
    const target = { metadata: null as MediaMetadata | null };
    const received: MediaMetadataInit[] = [];
    const current = track({ hasCover: true, coverVersion: 'v3' });

    const result = publishMediaSessionMetadata(target, current, {}, init => {
      received.push(init);
      return { marker: 'metadata' } as unknown as MediaMetadata;
    });

    expect(result).toBe('artwork');
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      title: current.title,
      artist: current.artist,
      album: current.album,
      artwork: [{ src: '/api/tracks/track-1/cover?v=v3' }]
    });
  });

  it('degrada para metadata textual quando artwork não é aceita', () => {
    const target = { metadata: null as MediaMetadata | null };
    const attempts: MediaMetadataInit[] = [];

    const result = publishMediaSessionMetadata(target, track(), {}, init => {
      attempts.push(init);
      if (init.artwork) throw new TypeError('artwork unsupported');
      return { marker: 'text-only' } as unknown as MediaMetadata;
    });

    expect(result).toBe('text-only');
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual({
      title: 'Águas de Março',
      artist: 'Elis Regina',
      album: 'Elis & Tom'
    });
  });

  it('não lança quando a capability não existe', () => {
    expect(publishMediaSessionMetadata(null, track(), {}, () => {
      throw new Error('unexpected factory call');
    })).toBe('unsupported');
  });

  it('absorve falha total da implementação da plataforma', () => {
    const target = { metadata: null as MediaMetadata | null };

    expect(publishMediaSessionMetadata(target, track(), {}, () => {
      throw new Error('partial platform');
    })).toBe('failed');
    expect(target.metadata).toBeNull();
  });
});
