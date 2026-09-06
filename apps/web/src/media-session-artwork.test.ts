import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import { canonicalCoverUrl, resolveMediaSessionArtwork } from './media-session-artwork';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track / 1',
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

describe('Media Session artwork', () => {
  it('reutiliza o endpoint canônico e coverVersion para capa efetiva online', () => {
    const current = track({ hasCover: true, coverVersion: 'override / v2' });

    expect(canonicalCoverUrl(current)).toBe('/api/tracks/track%20%2F%201/cover?v=override%20%2F%20v2');
    expect(resolveMediaSessionArtwork(current)).toEqual([
      { src: '/api/tracks/track%20%2F%201/cover?v=override%20%2F%20v2' }
    ]);
  });

  it('troca de coverVersion produz URL distinta sem endpoint paralelo', () => {
    const first = resolveMediaSessionArtwork(track({ hasCover: true, coverVersion: 'v1' }));
    const second = resolveMediaSessionArtwork(track({ hasCover: true, coverVersion: 'v2' }));

    expect(first[0]?.src).not.toBe(second[0]?.src);
    expect(second[0]?.src).toBe('/api/tracks/track%20%2F%201/cover?v=v2');
  });

  it('sem capa usa fallback estático local derivado da identidade canônica', () => {
    const artwork = resolveMediaSessionArtwork(track());

    expect(artwork).toHaveLength(1);
    expect(artwork[0]?.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(artwork[0]?.sizes).toBe('512x512');
    expect(artwork[0]?.type).toBe('image/svg+xml');
    expect(decodeURIComponent(artwork[0]!.src)).toContain('data-fallback-version="1"');
  });

  it('offline nunca depende do endpoint autenticado mesmo quando a faixa tinha capa', () => {
    const artwork = resolveMediaSessionArtwork(
      track({ hasCover: true, coverVersion: 'server-cover' }),
      { offlineMode: true }
    );

    expect(artwork[0]?.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(artwork[0]?.src).not.toContain('/api/tracks/');
  });

  it('não inclui path físico, provider externo ou segredo no fallback derivado', () => {
    const artwork = resolveMediaSessionArtwork(track({
      folderPath: '/mnt/music/segredo',
      id: 'safe-id'
    }));
    const decoded = decodeURIComponent(artwork[0]!.src);

    expect(decoded).not.toContain('/mnt/music/segredo');
    expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(decoded).not.toMatch(/https:\/\/|musicbrainz|coverartarchive|lrclib/i);
    expect(decoded).not.toContain('/api/tracks/');
    expect(decoded).not.toMatch(/token|secret|cookie/i);
  });
});
