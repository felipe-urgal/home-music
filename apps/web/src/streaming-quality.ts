export type StreamingMode = 'auto' | 'original' | 'economy';

export const STREAMING_MODE_STORAGE_KEY = 'home-music:streaming-mode:v1';

export function parseStreamingMode(raw: unknown): StreamingMode {
  return raw === 'original' || raw === 'economy' || raw === 'auto' ? raw : 'auto';
}

export function directAudioUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/stream`;
}

export function transcodedAudioUrl(trackId: string, quality: 'economy' | 'balanced' | 'high') {
  return `/api/tracks/${encodeURIComponent(trackId)}/transcode?quality=${quality}`;
}

export function onlineAudioUrl(trackId: string, mode: StreamingMode, compatibilityFallback = false) {
  if (compatibilityFallback) return transcodedAudioUrl(trackId, 'balanced');
  if (mode === 'economy') return transcodedAudioUrl(trackId, 'economy');
  return directAudioUrl(trackId);
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
