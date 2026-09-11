import type { RepeatMode, Track } from '@home-music/shared';
import { nextTrackDecision } from './player-state';

export const MAX_CROSSFADE_SECONDS = 30;
export type CrossfadeDeck = 'a' | 'b';

const CROSSFADE_SECONDS_STORAGE_KEY = 'home-music:crossfade-seconds:v2';
const LEGACY_CROSSFADE_MODE_STORAGE_KEY = 'home-music:crossfade-mode:v1';

export function otherCrossfadeDeck(deck: CrossfadeDeck): CrossfadeDeck {
  return deck === 'a' ? 'b' : 'a';
}

export function normalizeCrossfadeSeconds(value: unknown) {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.max(0, Math.min(MAX_CROSSFADE_SECONDS, Math.round(numericValue)));
}

export function readCrossfadeSeconds(storage: Pick<Storage, 'getItem'>) {
  const storedValue = storage.getItem(CROSSFADE_SECONDS_STORAGE_KEY);
  if (storedValue !== null) return normalizeCrossfadeSeconds(storedValue);

  const legacyMode = storage.getItem(LEGACY_CROSSFADE_MODE_STORAGE_KEY);
  if (legacyMode === 'soft') return 3;
  if (legacyMode === 'continuous') return 5;
  return 0;
}

export function writeCrossfadeSeconds(storage: Pick<Storage, 'setItem'>, seconds: number) {
  storage.setItem(CROSSFADE_SECONDS_STORAGE_KEY, String(normalizeCrossfadeSeconds(seconds)));
}

type CrossfadeCandidateOptions = {
  queue: Track[];
  currentIndex: number;
  currentTrackId: string | null;
  repeatMode: RepeatMode;
  durationSeconds: number;
  visibilityState: DocumentVisibilityState;
  remainingSeconds: number;
};

export type CrossfadeCandidate = {
  trackId: string;
  durationSeconds: number;
};

export function resolveCrossfadeCandidate({
  queue,
  currentIndex,
  currentTrackId,
  repeatMode,
  durationSeconds,
  visibilityState,
  remainingSeconds
}: CrossfadeCandidateOptions): CrossfadeCandidate | null {
  const normalizedDurationSeconds = normalizeCrossfadeSeconds(durationSeconds);
  if (!normalizedDurationSeconds || visibilityState !== 'visible') return null;
  if (
    !Number.isFinite(remainingSeconds)
    || remainingSeconds < 0
    || remainingSeconds > normalizedDurationSeconds
  ) return null;

  const decision = nextTrackDecision(queue, currentIndex, repeatMode, true);
  if (decision.type !== 'track' || decision.id === currentTrackId) return null;

  return {
    trackId: decision.id,
    durationSeconds: normalizedDurationSeconds
  };
}
