import { describe, expect, it, vi } from 'vitest';
import { applyTvRemotePlayerCommand, tvRemoteSnapshot, tvRemoteSnapshotKey } from './tv-remote-tv-controller';

function controls() {
  return {
    togglePlay: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
    seek: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeatMode: vi.fn(),
    playTrack: vi.fn(),
    setCrossfade: vi.fn()
  };
}

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

  it('publica shuffle e repetição quando o player fornece os modos', () => {
    expect(tvRemoteSnapshot({
      trackId: 'track-1',
      title: 'Faixa',
      artist: 'Artista',
      playing: false,
      currentTime: 12,
      duration: 120,
      shuffle: true,
      repeatMode: 'one'
    }, () => new Date('2026-09-12T18:00:00.000Z'))).toMatchObject({
      shuffle: true,
      repeatMode: 'one'
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
    const playerControls = controls();
    applyTvRemotePlayerCommand(
      { type: 'seek', deltaSeconds },
      { currentTime: deltaSeconds < 0 ? 5 : 118, duration: 120 },
      playerControls
    );
    expect(playerControls.seek).toHaveBeenCalledWith(deltaSeconds < 0 ? 0 : 120);
  });

  it('encaminha alteração remota de crossfade para o player canônico', () => {
    const playerControls = controls();

    applyTvRemotePlayerCommand(
      { type: 'set-crossfade', seconds: 30 },
      { currentTime: 25, duration: 180 },
      playerControls
    );

    expect(playerControls.setCrossfade).toHaveBeenCalledWith(30);
    expect(playerControls.seek).not.toHaveBeenCalled();
  });

  it('encaminha a seleção remota de faixa sem alterar seek', () => {
    const playerControls = controls();

    applyTvRemotePlayerCommand(
      { type: 'play-track', trackId: 'track-42' },
      { currentTime: 25, duration: 180 },
      playerControls
    );

    expect(playerControls.playTrack).toHaveBeenCalledWith('track-42');
    expect(playerControls.seek).not.toHaveBeenCalled();
  });
});
