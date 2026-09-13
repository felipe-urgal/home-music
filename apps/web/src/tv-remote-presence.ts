import type { TvRemoteTransportStatus } from './tv-remote-client';

export const TV_REMOTE_HEARTBEAT_STALE_MS = 30_000;

export function isTvRemotePlaybackFresh(
  transport: TvRemoteTransportStatus,
  lastSnapshotReceivedAt: number | null,
  now = Date.now()
) {
  return transport === 'open'
    && lastSnapshotReceivedAt !== null
    && now - lastSnapshotReceivedAt <= TV_REMOTE_HEARTBEAT_STALE_MS;
}
