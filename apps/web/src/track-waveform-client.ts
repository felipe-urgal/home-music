import type { TrackWaveform } from '@home-music/shared';
import { apiFetch } from './api-client';

export type TrackWaveformResult =
  | { status: 'ready'; waveform: TrackWaveform }
  | { status: 'pending'; waveform: null }
  | { status: 'unavailable'; waveform: null };

const waveformCache = new Map<string, Promise<TrackWaveformResult>>();

function validWaveform(value: unknown): value is TrackWaveform {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TrackWaveform>;
  return (
    typeof candidate.version === 'number'
    && Number.isInteger(candidate.version)
    && candidate.version > 0
    && typeof candidate.durationSeconds === 'number'
    && Number.isFinite(candidate.durationSeconds)
    && candidate.durationSeconds >= 0
    && Array.isArray(candidate.peaks)
    && candidate.peaks.length > 0
    && candidate.peaks.length <= 16_384
    && candidate.peaks.every(peak => Number.isFinite(peak) && peak >= 0 && peak <= 1)
  );
}

export async function fetchTrackWaveform(trackId: string): Promise<TrackWaveformResult> {
  if (!trackId) return { status: 'unavailable', waveform: null };
  const existing = waveformCache.get(trackId);
  if (existing) return existing;

  const request = apiFetch(`/api/tracks/${encodeURIComponent(trackId)}/waveform`)
    .then(async response => {
      if (response.status === 202) return { status: 'pending', waveform: null } as const;
      if (response.status === 404) return { status: 'unavailable', waveform: null } as const;
      if (!response.ok) throw new Error(`Falha ao carregar waveform (${response.status}).`);
      const payload: unknown = await response.json();
      return validWaveform(payload)
        ? { status: 'ready', waveform: payload } as const
        : { status: 'unavailable', waveform: null } as const;
    })
    .catch(() => ({ status: 'pending', waveform: null } as const));

  waveformCache.set(trackId, request);
  const result = await request;
  if (result.status === 'pending') waveformCache.delete(trackId);
  return result;
}

export function clearTrackWaveformCache(trackId?: string) {
  if (trackId) waveformCache.delete(trackId);
  else waveformCache.clear();
}

export { validWaveform };
