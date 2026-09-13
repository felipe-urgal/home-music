import { describe, expect, it, vi } from 'vitest';
import type { TvRemoteCommand } from '@home-music/shared/tv-remote';
import { applyTvRemoteCommand } from './tv-remote-command';

function controls() {
  return {
    togglePlay: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
    seekBy: vi.fn(),
    toggleShuffle: vi.fn(),
    cycleRepeatMode: vi.fn(),
    playTrack: vi.fn()
  };
}

describe('applyTvRemoteCommand', () => {
  it.each([
    [{ type: 'toggle-play' } as TvRemoteCommand, 'togglePlay'],
    [{ type: 'previous' } as TvRemoteCommand, 'previous'],
    [{ type: 'next' } as TvRemoteCommand, 'next'],
    [{ type: 'toggle-shuffle' } as TvRemoteCommand, 'toggleShuffle'],
    [{ type: 'cycle-repeat' } as TvRemoteCommand, 'cycleRepeatMode']
  ] as const)('aplica %o no controle canônico', (command, expected) => {
    const playerControls = controls();

    applyTvRemoteCommand(command, playerControls);

    expect(playerControls[expected]).toHaveBeenCalledTimes(1);
    expect(playerControls.seekBy).not.toHaveBeenCalled();
    expect(playerControls.playTrack).not.toHaveBeenCalled();
  });

  it.each([-10, 10] as const)('aplica seek de %ss sem inventar outro comando', deltaSeconds => {
    const playerControls = controls();

    applyTvRemoteCommand({ type: 'seek', deltaSeconds }, playerControls);

    expect(playerControls.seekBy).toHaveBeenCalledWith(deltaSeconds);
    expect(playerControls.togglePlay).not.toHaveBeenCalled();
    expect(playerControls.previous).not.toHaveBeenCalled();
    expect(playerControls.next).not.toHaveBeenCalled();
    expect(playerControls.toggleShuffle).not.toHaveBeenCalled();
    expect(playerControls.cycleRepeatMode).not.toHaveBeenCalled();
    expect(playerControls.playTrack).not.toHaveBeenCalled();
  });

  it('encaminha somente o id ao escolher uma música', () => {
    const playerControls = controls();

    applyTvRemoteCommand({ type: 'play-track', trackId: 'track-42' }, playerControls);

    expect(playerControls.playTrack).toHaveBeenCalledWith('track-42');
    expect(playerControls.togglePlay).not.toHaveBeenCalled();
    expect(playerControls.previous).not.toHaveBeenCalled();
    expect(playerControls.next).not.toHaveBeenCalled();
    expect(playerControls.seekBy).not.toHaveBeenCalled();
    expect(playerControls.toggleShuffle).not.toHaveBeenCalled();
    expect(playerControls.cycleRepeatMode).not.toHaveBeenCalled();
  });
});
