import type { NormalizationMode, RepeatMode, Track } from '@home-music/shared';
import { nextTrackDecision } from './player-state';
import {
  effectiveNormalizationMode,
  preloadAudioUrl,
  type StreamingMode
} from './streaming-quality';

export type NextTrackPreload = {
  trackId: string;
  url: string;
};

export type PreloadFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export function resolveNextTrackPreload(
  queue: Track[],
  currentIndex: number,
  repeatMode: RepeatMode,
  streamingMode: StreamingMode,
  normalizationMode: NormalizationMode
): NextTrackPreload | null {
  const decision = nextTrackDecision(queue, currentIndex, repeatMode, true);
  if (decision.type !== 'track') return null;

  const track = queue.find(item => item.id === decision.id);
  if (!track) return null;

  const normalization = effectiveNormalizationMode(track, normalizationMode);
  const url = preloadAudioUrl(track.id, streamingMode, normalization);
  return url ? { trackId: track.id, url } : null;
}

export async function warmTranscodedTrack(
  fetcher: PreloadFetcher,
  url: string,
  signal?: AbortSignal
) {
  const response = await fetcher(url, {
    cache: 'no-store',
    headers: { Range: 'bytes=0-0' },
    signal
  });

  if (!response.ok) return false;
  await response.arrayBuffer();
  return true;
}
