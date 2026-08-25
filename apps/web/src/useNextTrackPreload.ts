import { useEffect, useMemo } from 'react';
import type { NormalizationMode, RepeatMode, Track } from '@home-music/shared';
import { apiFetch } from './api-client';
import { resolveNextTrackPreload, warmTranscodedTrack } from './next-track-preload';
import type { StreamingMode } from './streaming-quality';

const PRELOAD_DELAY_MS = 1_000;

type NextTrackPreloadOptions = {
  queue: Track[];
  currentIndex: number;
  repeatMode: RepeatMode;
  streamingMode: StreamingMode;
  normalizationMode: NormalizationMode;
  playing: boolean;
};

export function useNextTrackPreload({
  queue,
  currentIndex,
  repeatMode,
  streamingMode,
  normalizationMode,
  playing
}: NextTrackPreloadOptions) {
  const candidate = useMemo(() => resolveNextTrackPreload(
    queue,
    currentIndex,
    repeatMode,
    streamingMode,
    normalizationMode
  ), [currentIndex, normalizationMode, queue, repeatMode, streamingMode]);

  useEffect(() => {
    if (!playing || !candidate) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void warmTranscodedTrack(apiFetch, candidate.url, controller.signal)
        .catch(() => undefined);
    }, PRELOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [candidate, playing]);
}
