import { useCallback, useEffect, useState } from 'react';
import type { LyricsResponse, Track } from '@home-music/shared';
import { apiFetch } from './api-client';
import { readOfflineLyricsSnapshot } from './offline-lyrics-cache';

const LYRICS_PROBE_DELAY_MS = 250;
const inFlightLyricsRequests = new Map<string, Promise<LyricsResponse | null>>();

export type TrackLyricsState =
  | { status: 'idle' | 'loading' | 'missing' | 'error'; lyrics: null }
  | { status: 'available'; lyrics: LyricsResponse };

const idle: TrackLyricsState = { status: 'idle', lyrics: null };
const loading: TrackLyricsState = { status: 'loading', lyrics: null };

export function loadTrackLyrics(trackId: string) {
  const existing = inFlightLyricsRequests.get(trackId);
  if (existing) return existing;

  let request: Promise<LyricsResponse | null>;
  request = apiFetch(`/api/tracks/${encodeURIComponent(trackId)}/lyrics`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000)
  })
    .then(async response => {
      if (!response.ok) throw new Error(`Não foi possível carregar a letra (HTTP ${response.status}).`);
      return response.json() as Promise<LyricsResponse | null>;
    })
    .finally(() => {
      if (inFlightLyricsRequests.get(trackId) === request) {
        inFlightLyricsRequests.delete(trackId);
      }
    });

  inFlightLyricsRequests.set(trackId, request);
  return request;
}

export function useTrackLyricsState(track: Track | null | undefined, offlineMode = false) {
  const trackId = track?.id ?? null;
  const [result, setResult] = useState<{ trackId: string | null; state: TrackLyricsState }>({
    trackId: null,
    state: idle
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!trackId) return;
    let disposed = false;
    if (offlineMode) {
      const lyrics = readOfflineLyricsSnapshot(trackId);
      setResult({ trackId, state: lyrics ? { status: 'available', lyrics } : { status: 'missing', lyrics: null } });
      return;
    }
    setResult({ trackId, state: loading });
    const timeout = window.setTimeout(() => {
      void loadTrackLyrics(trackId).then(lyrics => {
        if (!disposed) setResult({
          trackId,
          state: lyrics ? { status: 'available', lyrics } : { status: 'missing', lyrics: null }
        });
      }).catch(() => {
        if (!disposed) setResult({ trackId, state: { status: 'error', lyrics: null } });
      });
    }, attempt === 0 ? LYRICS_PROBE_DELAY_MS : 0);

    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [trackId, offlineMode, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  return {
    ...((result.trackId === trackId && trackId) ? result.state : idle),
    retry
  };
}

// Compatibilidade com consumidores que precisam apenas do conteúdo.
export function useTrackLyrics(track: Track | null | undefined, offlineMode = false) {
  return useTrackLyricsState(track, offlineMode).lyrics;
}
