import { describe, expect, it } from 'vitest';
import { crossfadeConfirmation } from './useRemoteCrossfade';
import type { TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
const base: TvRemotePlaybackSnapshot = { trackId: null, title: null, artist: null, playing: false, currentTime: 0, duration: 0, updatedAt: '2026-09-14T00:00:00Z' };
describe('canonical crossfade confirmation', () => {
  it('does not confirm legacy, incomplete or coincident old snapshots', () => {
    expect(crossfadeConfirmation(base, 4, 5)).toBeNull();
    expect(crossfadeConfirmation({ ...base, crossfadeSeconds: 5 }, 4, 5)).toBeNull();
    expect(crossfadeConfirmation({ ...base, crossfadeSeconds: 5, lastAppliedCrossfadeCommandId: 3 }, 4, 5)).toBeNull();
  });
  it('confirms the exact pair, including 0/3/5/30 with no playing track', () => {
    for (const seconds of [0, 3, 5, 30]) expect(crossfadeConfirmation({ ...base, crossfadeSeconds: seconds, lastAppliedCrossfadeCommandId: 4 }, 4, seconds)).toBe(`Crossfade: ${seconds} s`);
  });
  it('reports superseded commands and later local changes without false success', () => {
    expect(crossfadeConfirmation({ ...base, crossfadeSeconds: 5, lastAppliedCrossfadeCommandId: 6 }, 4, 5)).toContain('prevaleceu');
    expect(crossfadeConfirmation({ ...base, crossfadeSeconds: 3, lastAppliedCrossfadeCommandId: 4 }, 4, 5)).toContain('já foi alterado');
  });
});
