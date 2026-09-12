import { describe, expect, it, vi } from 'vitest';
import { applyTvRemotePlayerCommand, tvRemoteSnapshot, tvRemoteSnapshotKey } from './tv-remote-tv-controller';

describe('tv remote TV controller', () => {
  it('normaliza o snapshot publicado pela TV', () => {
    expect(tvRemoteSnapshot({
      trackId: 'track-1',
      title: 'Faixa',
      artist: 'Artista',
      playing: true,
      currentTime: 130,
      duration: 120
    }, () => new Date('2026-09-12T18:00:00.000Z'))).toEqual({
      trackId: 'track-1',
      title: 'Faixa',
      artist: 'Artista',
      playing: true,
      currentTime: 120,
      duration: 120,
      updatedAt: '2026-09-12T18:00:00.000Z'
    });
  });

  it('ignora timestamp e pequenas frações para detectar mudança material', () => {
    const base = tvRemoteSnapshot({
      trackId: 'track-1', title: 'Faixa', artist: 'Artista', playing: true,
      currentTime: 10.1, duration: 120
    }, () => new Date('2026-09-12T18:00:00.000Z'));
    const next = { ...base, currentTime: 10.2, updatedAt: '2026-09-12T18:00:01.000Z' };
    expect(tvRemoteSnapshotKey(next)).toBe(tvRemoteSnapshotKey(base));
  });

  it.each([-10, 10] as const)('converte seek remoto %ss para posição absoluta limitada', deltaSeconds => {
    const controls = {
      togglePlay: vi.fn(), previous: vi.fn(), next: vi.fn(), seek: vi.fn()
    };
    applyTvRemotePlayerCommand(
      { type: 'seek', deltaSeconds },
      { currentTime: deltaSeconds < 0 ? 5 : 118, duration: 120 },
      controls
    );
    expect(controls.seek).toHaveBeenCalledWith(deltaSeconds < 0 ? 0 : 120);
  });
});
