import { describe, expect, it, vi } from 'vitest';
import type { PlaybackState } from '@home-music/shared';
import { createPlaybackStateWriteCoordinator, type PlaybackStateSnapshot } from './playback-state-persistence';

function snapshot(position: number): PlaybackStateSnapshot {
  return {
    currentTrackId: 'track-a',
    position,
    volume: 1,
    shuffle: false,
    repeatMode: 'off',
    wasPlaying: true,
    baseQueueIds: ['track-a'],
    queueIds: ['track-a']
  };
}

function state(position: number, updatedAt: string): PlaybackState {
  return { ...snapshot(position), updatedAt };
}

describe('playback state write coordinator', () => {
  it('serializa writes para um estado antigo nunca terminar depois do mais novo', async () => {
    let resolveFirst: ((value: { status: 'ok'; state: PlaybackState }) => void) | null = null;
    const calls: PlaybackState[] = [];
    const save = vi.fn((value: PlaybackState) => {
      calls.push(value);
      if (calls.length === 1) {
        return new Promise<{ status: 'ok'; state: PlaybackState }>(resolve => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({ status: 'ok' as const, state: state(value.position, '2026-10-04T18:00:00.002Z') });
    });
    const coordinator = createPlaybackStateWriteCoordinator('2026-10-04T18:00:00.000Z', save);

    const first = coordinator.persist(snapshot(10), 'state-change');
    await Promise.resolve();
    const second = coordinator.persist(snapshot(20), 'state-change');

    resolveFirst?.({ status: 'ok', state: state(10, '2026-10-04T18:00:00.001Z') });
    await Promise.all([first, second]);

    expect(calls.map(call => call.position)).toEqual([10, 20]);
    expect(calls[1].updatedAt).toBe('2026-10-04T18:00:00.001Z');
  });

  it('bloqueia heartbeat de aba obsoleta após conflito e permite nova ação explícita', async () => {
    const calls: PlaybackState[] = [];
    const save = vi.fn(async (value: PlaybackState) => {
      calls.push(value);
      if (calls.length === 1) {
        return { status: 'conflict' as const, state: state(30, '2026-10-04T18:00:00.005Z') };
      }
      return { status: 'ok' as const, state: state(value.position, '2026-10-04T18:00:00.006Z') };
    });
    const coordinator = createPlaybackStateWriteCoordinator('2026-10-04T18:00:00.000Z', save);

    await coordinator.persist(snapshot(10), 'heartbeat');
    await coordinator.persist(snapshot(11), 'heartbeat');
    await coordinator.persist(snapshot(40), 'state-change');

    expect(calls.map(call => call.position)).toEqual([10, 40, 40]);
    expect(calls[1].updatedAt).toBe('2026-10-04T18:00:00.005Z');
  });
});
