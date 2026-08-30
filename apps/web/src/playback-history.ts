import { apiFetch } from './api-client';
import { notifyPlaylistsChanged } from './library-events';

const PLAYBACK_TRACK_PATH = /^\/api\/tracks\/([^/]+)\/(?:stream|transcode)$/;
let installed = false;

export function trackIdFromPlaybackUrl(value: string, baseUrl = 'http://localhost') {
  try {
    const pathname = new URL(value, baseUrl).pathname;
    const match = PLAYBACK_TRACK_PATH.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export async function recordCompletedPlayback(trackId: string) {
  if (!trackId) return false;

  const response = await apiFetch(`/api/history/${encodeURIComponent(trackId)}`, {
    method: 'POST',
    headers: { 'X-Home-Music-Request': '1' }
  });
  if (!response.ok) return false;

  notifyPlaylistsChanged();
  return true;
}

function handlePlaybackEnded(event: Event) {
  if (!(event.target instanceof HTMLAudioElement)) return;
  const source = event.target.currentSrc || event.target.src;
  const trackId = trackIdFromPlaybackUrl(source, window.location.origin);
  if (!trackId) return;

  void recordCompletedPlayback(trackId).catch(() => undefined);
}

export function installPlaybackHistoryTracking() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('ended', handlePlaybackEnded, true);
}
