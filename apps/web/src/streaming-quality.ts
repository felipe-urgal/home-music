import type { NormalizationMode, Track } from '@home-music/shared';

export type StreamingMode = 'auto' | 'original' | 'economy';
export type StreamingSelection = 'network' | StreamingMode;
export type NetworkPreference = 'auto' | 'wifi' | 'mobile';
export type DetectedNetwork = 'wifi' | 'mobile' | 'unknown';

export type NetworkConnectionSnapshot = {
  type?: string | null;
  effectiveType?: string | null;
  saveData?: boolean | null;
};

export const STREAMING_MODE_STORAGE_KEY = 'home-music:streaming-mode:v1';
export const STREAMING_SELECTION_STORAGE_KEY = 'home-music:streaming-selection:v1';
export const NETWORK_PREFERENCE_STORAGE_KEY = 'home-music:network-preference:v1';
export const NORMALIZATION_MODE_STORAGE_KEY = 'home-music:normalization-mode:v1';

export function parseNormalizationMode(raw: unknown): NormalizationMode {
  return raw === 'track' || raw === 'album' ? raw : 'off';
}

export function resolveReplayGain(track: Track, mode: NormalizationMode) {
  if (mode === 'off') return null;
  const value = mode === 'album'
    ? track.replayGainAlbumDb ?? track.replayGainTrackDb
    : track.replayGainTrackDb;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function effectiveNormalizationMode(track: Track, mode: NormalizationMode): NormalizationMode {
  return resolveReplayGain(track, mode) == null ? 'off' : mode;
}

export function parseStreamingMode(raw: unknown): StreamingMode {
  return raw === 'original' || raw === 'economy' || raw === 'auto' ? raw : 'auto';
}

export function parseStreamingSelection(raw: unknown): StreamingSelection {
  return raw === 'network' || raw === 'original' || raw === 'economy' || raw === 'auto' ? raw : 'auto';
}

export function parseNetworkPreference(raw: unknown): NetworkPreference {
  return raw === 'wifi' || raw === 'mobile' || raw === 'auto' ? raw : 'auto';
}

export function detectNetwork(snapshot: NetworkConnectionSnapshot | null | undefined): DetectedNetwork {
  if (!snapshot) return 'unknown';
  const type = snapshot.type?.trim().toLowerCase();
  const effectiveType = snapshot.effectiveType?.trim().toLowerCase();

  if (type === 'wifi' || type === 'ethernet') return 'wifi';
  if (type === 'cellular' || type === 'wimax') return 'mobile';
  if (snapshot.saveData === true) return 'mobile';
  if (effectiveType === 'slow-2g' || effectiveType === '2g' || effectiveType === '3g') return 'mobile';
  return 'unknown';
}

export function resolveNetworkStreamingMode(
  networkPreference: NetworkPreference,
  detectedNetwork: DetectedNetwork
): StreamingMode {
  const network = networkPreference === 'auto' ? detectedNetwork : networkPreference;
  return network === 'mobile' ? 'economy' : 'auto';
}

export function directAudioUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

export function transcodedAudioUrl(
  trackId: string,
  quality: 'economy' | 'balanced' | 'high',
  normalization: NormalizationMode = 'off'
) {
  const suffix = normalization === 'off' ? '' : `&normalization=${normalization}`;
  return `/api/tracks/${encodeURIComponent(trackId)}/transcode?quality=${quality}${suffix}`;
}

export function onlineAudioUrl(
  trackId: string,
  mode: StreamingMode,
  compatibilityFallback = false,
  normalization: NormalizationMode = 'off'
) {
  if (compatibilityFallback) return transcodedAudioUrl(trackId, 'balanced', normalization);
  if (mode === 'economy') return transcodedAudioUrl(trackId, 'economy', normalization);
  if (normalization !== 'off') return transcodedAudioUrl(trackId, 'high', normalization);
  return directAudioUrl(trackId);
}

export function preloadAudioUrl(
  trackId: string,
  mode: StreamingMode,
  normalization: NormalizationMode = 'off'
) {
  if (mode === 'economy') return transcodedAudioUrl(trackId, 'economy', normalization);
  if (normalization !== 'off') return transcodedAudioUrl(trackId, 'high', normalization);
  return null;
}

export function shouldRetryWithCompatibilityTranscode(mode: StreamingMode, mediaErrorCode: number | null | undefined) {
  return mode === 'auto' && (mediaErrorCode === 3 || mediaErrorCode === 4);
}

export function shouldFallbackToOriginal(mode: StreamingMode, mediaErrorCode: number | null | undefined) {
  return mode === 'economy' && (mediaErrorCode === 3 || mediaErrorCode === 4);
}

export function readStreamingMode(storage: Pick<Storage, 'getItem'>): StreamingMode {
  try {
    return parseStreamingMode(storage.getItem(STREAMING_MODE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function writeStreamingMode(storage: Pick<Storage, 'setItem'>, mode: StreamingMode) {
  try {
    storage.setItem(STREAMING_MODE_STORAGE_KEY, mode);
  } catch {
    // Preferência é best-effort; falha de storage não impede reprodução.
  }
}

export function readStreamingSelection(storage: Pick<Storage, 'getItem'>): StreamingSelection {
  try {
    return parseStreamingSelection(storage.getItem(STREAMING_SELECTION_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function writeStreamingSelection(storage: Pick<Storage, 'setItem'>, mode: StreamingSelection) {
  try {
    storage.setItem(STREAMING_SELECTION_STORAGE_KEY, mode);
  } catch {
    // Preferência é best-effort; falha de storage não impede reprodução.
  }
}

export function readNetworkPreference(storage: Pick<Storage, 'getItem'>): NetworkPreference {
  try {
    return parseNetworkPreference(storage.getItem(NETWORK_PREFERENCE_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

export function writeNetworkPreference(storage: Pick<Storage, 'setItem'>, preference: NetworkPreference) {
  try {
    storage.setItem(NETWORK_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Preferência é best-effort; falha de storage não impede reprodução.
  }
}

export function readNormalizationMode(storage: Pick<Storage, 'getItem'>): NormalizationMode {
  try {
    return parseNormalizationMode(storage.getItem(NORMALIZATION_MODE_STORAGE_KEY));
  } catch {
    return 'off';
  }
}

export function writeNormalizationMode(storage: Pick<Storage, 'setItem'>, mode: NormalizationMode) {
  try {
    storage.setItem(NORMALIZATION_MODE_STORAGE_KEY, mode);
  } catch {
    // Preferência é local e best-effort.
  }
}
