import { useEffect, useState } from 'react';
import type { LyricsResponse, Track } from '@home-music/shared';
import { apiFetch } from './api-client';

const LYRICS_PROBE_DELAY_MS = 250;

export function useTrackLyrics(track: Track | null | undefined, offlineMode = false) {
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [resolvedTrackId, setResolvedTrackId] = useState<string | null>(null);

  useEffect(() => {
    setLyrics(null);
    setResolvedTrackId(null);
    if (!track || offlineMode) return;

    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => {
      void apiFetch(`/api/tracks/${track.id}/lyrics`, {
        signal: controller.signal,
        cache: 'no-store'
      })
        .then(async response => {
          if (!response.ok) throw new Error('Não foi possível verificar a letra.');
          return response.json() as Promise<LyricsResponse | null>;
        })
        .then(data => {
          if (disposed) return;
          setLyrics(data);
          setResolvedTrackId(track.id);
        })
        .catch(reason => {
          if (disposed || (reason instanceof Error && reason.name === 'AbortError')) return;
          setLyrics(null);
          setResolvedTrackId(track.id);
        });
    }, LYRICS_PROBE_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [offlineMode, track?.id]);

  return resolvedTrackId === track?.id ? lyrics : null;
}
