import { describe, expect, it, vi } from 'vitest';
import type { TvRemoteCommand } from '@home-music/shared';
import { applyTvRemoteCommand } from './tv-remote-command';

describe('applyTvRemoteCommand', () => {
  it.each([
    [{ type: 'toggle-play' } as TvRemoteCommand, 'togglePlay'],
    [{ type: 'previous' } as TvRemoteCommand, 'previous'],
    [{ type: 'next' } as TvRemoteCommand, 'next']
  ] as const)('aplica %o no controle canônico', (command, expected) => {
    const controls = {
      togglePlay: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      seekBy: vi.fn()
    };

    applyTvRemoteCommand(command, controls);

    expect(controls[expected]).toHaveBeenCalledTimes(1);
    expect(controls.seekBy).not.toHaveBeenCalled();
  });

  it.each([-10, 10] as const)('aplica seek de %ss sem inventar outro comando', deltaSeconds => {
    const controls = {
      togglePlay: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      seekBy: vi.fn()
    };

    applyTvRemoteCommand({ type: 'seek', deltaSeconds }, controls);

    expect(controls.seekBy).toHaveBeenCalledWith(deltaSeconds);
    expect(controls.togglePlay).not.toHaveBeenCalled();
    expect(controls.previous).not.toHaveBeenCalled();
    expect(controls.next).not.toHaveBeenCalled();
  });
});
