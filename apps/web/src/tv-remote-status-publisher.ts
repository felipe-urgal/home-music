import type { TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import { tvRemoteSnapshotKey } from './tv-remote-tv-controller';

// One request at a time; coalesce changes into the latest committed render.
export function createTvRemoteStatusPublisher(
  snapshot: () => TvRemotePlaybackSnapshot,
  send: (snapshot: TvRemotePlaybackSnapshot) => Promise<void>,
  onError: (error: unknown) => void
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let dirty = false;
  let force = false;
  let lastStartedAt = -Infinity;
  let lastKey = '';

  function schedule() {
    if (stopped || inFlight || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, Math.max(0, 1000 - (Date.now() - lastStartedAt)));
  }
  async function flush() {
    if (stopped || inFlight) return;
    const value = snapshot();
    const key = tvRemoteSnapshotKey(value);
    dirty = false;
    const forced = force;
    force = false;
    if (!forced && key === lastKey) return;
    inFlight = true;
    lastStartedAt = Date.now();
    try {
      await send(value);
      if (!stopped) lastKey = key;
    } catch (error) {
      if (!stopped) onError(error);
    } finally {
      inFlight = false;
      if (!stopped && dirty) schedule();
    }
  }
  return {
    request(heartbeat = false) {
      if (stopped) return;
      dirty = true;
      force ||= heartbeat;
      schedule();
    },
    stop() { stopped = true; clearTimeout(timer); }
  };
}
