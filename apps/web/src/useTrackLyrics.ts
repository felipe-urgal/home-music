import { useEffect, useState } from 'react';
import type { LyricsResponse, Track } from '@home-music/shared';
import { apiFetch } from './api-client';
import { readOfflineLyricsSnapshot } from './offline-lyrics-cache';

const LYRICS_PROBE_DELAY_MS = 250;
const inFlightLyricsRequests = new Map<string, Promise<LyricsResponse | null>>();

export function loadTrackLyrics(trackId: string) {
  const existing = inFlightLyricsRequests.get(trackId);
  if (existing) return existing;

  let request: Promise<LyricsResponse | null>;
  request = apiFetch(`/api/tracks/${trackId}/lyrics`, {
    cache: 'no-store'
  })
    .then(async response => {
      if (!response.ok) throw new Error('Não foi possível verificar a letra.');
      return response.json() as Promise<LyricsResponse | null>;
    })
    .catch(() => null)
    .finally(() => {
      if (inFlightLyricsRequests.get(trackId) === request) {
        inFlightLyricsRequests.delete(trackId);
      }
    });

  inFlightLyricsRequests.set(trackId, request);
  return request;
}

export function useTrackLyrics(track: Track | null | undefined, offlineMode = false) {
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [resolvedTrackId, setResolvedTrackId] = useState<string | null>(null);

  useEffect(() => {
    setLyrics(null);
    setResolvedTrackId(null);
    if (!track) return;

    if (offlineMode) {
      setLyrics(readOfflineLyricsSnapshot(track.id));
      setResolvedTrackId(track.id);
      return;
    }

    let disposed = false;
    const timeout = window.setTimeout(() => {
      void loadTrackLyrics(track.id).then(data => {
        if (disposed) return;
        setLyrics(data);
        setResolvedTrackId(track.id);
      });
    }, LYRICS_PROBE_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [offlineMode, track?.id]);

  return resolvedTrackId === track?.id ? lyrics : null;
}
