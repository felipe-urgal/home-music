import type { RepeatMode, Track } from '@home-music/shared';
import { nextTrackDecision } from './player-state';

export type CrossfadeMode = 'off' | 'soft' | 'continuous';

const CROSSFADE_STORAGE_KEY = 'home-music:crossfade-mode:v1';

export function crossfadeDurationSeconds(mode: CrossfadeMode) {
  if (mode === 'soft') return 3;
  if (mode === 'continuous') return 5;
  return 0;
}

export function readCrossfadeMode(storage: Pick<Storage, 'getItem'>): CrossfadeMode {
  const value = storage.getItem(CROSSFADE_STORAGE_KEY);
  return value === 'soft' || value === 'continuous' ? value : 'off';
}

export function writeCrossfadeMode(storage: Pick<Storage, 'setItem'>, mode: CrossfadeMode) {
  storage.setItem(CROSSFADE_STORAGE_KEY, mode);
}

type CrossfadeCandidateOptions = {
  queue: Track[];
  currentIndex: number;
  currentTrackId: string | null;
  repeatMode: RepeatMode;
  mode: CrossfadeMode;
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
  mode,
  visibilityState,
  remainingSeconds
}: CrossfadeCandidateOptions): CrossfadeCandidate | null {
  const durationSeconds = crossfadeDurationSeconds(mode);
  if (!durationSeconds || visibilityState !== 'visible') return null;
  if (!Number.isFinite(remainingSeconds) || remainingSeconds < 0 || remainingSeconds > durationSeconds) return null;

  const decision = nextTrackDecision(queue, currentIndex, repeatMode, true);
  if (decision.type !== 'track' || decision.id === currentTrackId) return null;

  return {
    trackId: decision.id,
    durationSeconds
  };
}
