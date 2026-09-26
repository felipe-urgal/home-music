import type { TrackWaveform } from '@home-music/shared';
import { apiFetch } from './api-client';

const waveformCache = new Map<string, Promise<TrackWaveform | null>>();

function validWaveform(value: unknown): value is TrackWaveform {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TrackWaveform>;
  return (
    Number.isInteger(candidate.version)
    && Number(candidate.version) > 0
    && Number.isFinite(candidate.durationSeconds)
    && Number(candidate.durationSeconds) >= 0
    && Array.isArray(candidate.peaks)
    && candidate.peaks.length > 0
    && candidate.peaks.length <= 16_384
    && candidate.peaks.every(peak => Number.isFinite(peak) && peak >= 0 && peak <= 1)
  );
}

export async function fetchTrackWaveform(trackId: string): Promise<TrackWaveform | null> {
  if (!trackId) return null;
  const existing = waveformCache.get(trackId);
  if (existing) return existing;

  const request = apiFetch(`/api/tracks/${encodeURIComponent(trackId)}/waveform`)
    .then(async response => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Falha ao carregar waveform (${response.status}).`);
      const payload: unknown = await response.json();
      return validWaveform(payload) ? payload : null;
    })
    .catch(() => null);

  waveformCache.set(trackId, request);
  const result = await request;
  if (!result) waveformCache.delete(trackId);
  return result;
}

export function clearTrackWaveformCache(trackId?: string) {
  if (trackId) waveformCache.delete(trackId);
  else waveformCache.clear();
}

export { validWaveform };
