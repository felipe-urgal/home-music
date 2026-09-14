import { useEffect, useMemo, type RefObject } from 'react';
import type { NormalizationMode, RepeatMode, Track } from '@home-music/shared';
import { apiFetch } from './api-client';
import { resolveNextTrackPreload, warmTranscodedTrack } from './next-track-preload';
import type { StreamingMode } from './streaming-quality';

const PRELOAD_DELAY_MS = 1_000;

type NextTrackPreloadOptions = {
  cancellationRef: RefObject<(() => void) | null>;
  queue: Track[];
  currentIndex: number;
  repeatMode: RepeatMode;
  streamingMode: StreamingMode;
  normalizationMode: NormalizationMode;
  playing: boolean;
  manualPlaybackRevision: number;
};

export function useNextTrackPreload({
  cancellationRef,
  queue,
  currentIndex,
  repeatMode,
  streamingMode,
  normalizationMode,
  playing,
  manualPlaybackRevision
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

    const cancel = () => { window.clearTimeout(timeout); controller.abort(); };
    cancellationRef.current = cancel;
    return () => {
      cancel();
      if (cancellationRef.current === cancel) cancellationRef.current = null;
    };
  }, [candidate, playing, manualPlaybackRevision, cancellationRef]);
}
