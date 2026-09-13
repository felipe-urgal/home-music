import { describe, expect, it } from 'vitest';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared';

describe('contrato remoto compartilhado', () => {
  it('expõe comandos e modos ampliados também pelo export raiz', () => {
    const commands: TvRemoteCommand[] = [
      { type: 'toggle-shuffle' },
      { type: 'cycle-repeat' },
      { type: 'play-track', trackId: 'track-42' }
    ];
    const snapshot: TvRemotePlaybackSnapshot = {
      trackId: 'track-42',
      title: 'Title',
      artist: 'Artist',
      playing: true,
      currentTime: 12,
      duration: 120,
      updatedAt: '2026-09-13T12:00:00.000Z',
      shuffle: true,
      repeatMode: 'one'
    };

    expect(commands.map(command => command.type)).toEqual(['toggle-shuffle', 'cycle-repeat', 'play-track']);
    expect(snapshot.shuffle).toBe(true);
    expect(snapshot.repeatMode).toBe('one');
  });
});
