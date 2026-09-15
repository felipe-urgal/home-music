import { describe, expect, it, vi } from 'vitest';
import type { TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import {
  createRemoteCrossfadeController,
  type RemoteCrossfadeState
} from './remote-crossfade-controller';

const snapshot = (crossfadeSeconds: number, lastAppliedCrossfadeCommandId: number): TvRemotePlaybackSnapshot => ({
  trackId: null,
  title: null,
  artist: null,
  playing: false,
  currentTime: 0,
  duration: 0,
  updatedAt: '2026-09-15T00:00:00.000Z',
  crossfadeSeconds,
  lastAppliedCrossfadeCommandId
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function harness(sessionId = 'session-a') {
  const request = deferred<number>();
  const states: RemoteCrossfadeState[] = [];
  const clearTimer = vi.fn();
  let timer: (() => void) | null = null;
  let signal: AbortSignal | null = null;
  const send = vi.fn((_sessionId: string, _seconds: number, nextSignal: AbortSignal) => {
    signal = nextSignal;
    return request.promise;
  });
  const controller = createRemoteCrossfadeController(sessionId, {
    send,
    setTimer: callback => {
      timer = callback;
      return 1;
    },
    clearTimer,
    onState: state => states.push(state)
  });
  controller.update(snapshot(0, 0), true);
  return {
    controller,
    request,
    send,
    states,
    clearTimer,
    signal: () => signal,
    timeout: () => {
      if (!timer) throw new Error('Timer não registrado.');
      timer();
    }
  };
}

describe('remote crossfade command lifecycle', () => {
  it('confirms when the matching snapshot arrives before the HTTP 202 response', async () => {
    const test = harness();
    const choosing = test.controller.choose(5);

    test.controller.update(snapshot(5, 7), true);
    test.request.resolve(7);
    await choosing;

    expect(test.send).toHaveBeenCalledWith('session-a', 5, expect.any(AbortSignal));
    expect(test.states).toEqual([
      { pending: 5, message: null },
      { pending: null, message: 'Crossfade: 5 s' }
    ]);
  });

  it('aborts on timeout and ignores a late HTTP response and snapshot', async () => {
    const test = harness();
    const choosing = test.controller.choose(3);

    expect(test.signal()?.aborted).toBe(false);
    test.timeout();
    expect(test.signal()?.aborted).toBe(true);
    expect(test.states.at(-1)).toEqual({
      pending: null,
      message: 'A TV não confirmou a alteração. Confira o valor e tente novamente.'
    });

    test.request.resolve(8);
    await choosing;
    test.controller.update(snapshot(3, 8), true);

    expect(test.states.at(-1)).toEqual({
      pending: null,
      message: 'A TV não confirmou a alteração. Confira o valor e tente novamente.'
    });
  });

  it('discards a pending command on disconnect and ignores its late response', async () => {
    const test = harness();
    const choosing = test.controller.choose(5);

    test.controller.update(snapshot(0, 0), false);
    expect(test.signal()?.aborted).toBe(true);
    expect(test.states.at(-1)).toEqual({ pending: null, message: null });

    test.request.resolve(9);
    await choosing;
    test.controller.update(snapshot(5, 9), true);

    expect(test.states.at(-1)).toEqual({ pending: null, message: null });
  });

  it('disposes the old session without allowing a late response to emit state', async () => {
    const test = harness();
    const choosing = test.controller.choose(30);

    test.controller.dispose();
    expect(test.signal()?.aborted).toBe(true);
    const stateCount = test.states.length;

    test.request.resolve(10);
    await choosing;

    expect(test.states).toHaveLength(stateCount);
  });

  it('resolves competing controllers from the shared command watermark', async () => {
    const first = harness('session-a');
    const second = harness('session-a');
    const choosingFirst = first.controller.choose(3);
    const choosingSecond = second.controller.choose(5);

    first.request.resolve(11);
    second.request.resolve(12);
    await Promise.all([choosingFirst, choosingSecond]);

    const canonical = snapshot(5, 12);
    first.controller.update(canonical, true);
    second.controller.update(canonical, true);

    expect(first.states.at(-1)?.message).toContain('prevaleceu');
    expect(second.states.at(-1)).toEqual({ pending: null, message: 'Crossfade: 5 s' });
  });
});
