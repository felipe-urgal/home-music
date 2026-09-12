import { useSyncExternalStore } from 'react';
import type { Track } from '@home-music/shared';

export type CrossfadeVisualState = {
  attempt: number;
  originTrackId: string;
  incomingTrack: Track;
  durationSeconds: number;
  elapsedSeconds: number;
};

const MIN_VISUAL_FRAME_SECONDS = 1 / 30;

let crossfadeVisualState: CrossfadeVisualState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setCrossfadeVisualState(nextState: CrossfadeVisualState) {
  crossfadeVisualState = nextState;
  emit();
}

export function syncCrossfadeVisualElapsed(attempt: number, elapsedSeconds: number) {
  if (!crossfadeVisualState || crossfadeVisualState.attempt !== attempt) return;
  if (!Number.isFinite(elapsedSeconds)) return;

  const duration = Math.max(0, crossfadeVisualState.durationSeconds);
  const nextElapsed = Math.max(0, Math.min(duration, elapsedSeconds));
  const previousElapsed = crossfadeVisualState.elapsedSeconds;
  if (nextElapsed < duration && Math.abs(nextElapsed - previousElapsed) < MIN_VISUAL_FRAME_SECONDS) return;

  crossfadeVisualState = {
    ...crossfadeVisualState,
    elapsedSeconds: nextElapsed
  };
  emit();
}

export function clearCrossfadeVisualState(attempt?: number) {
  if (!crossfadeVisualState) return;
  if (attempt !== undefined && crossfadeVisualState.attempt !== attempt) return;
  crossfadeVisualState = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return crossfadeVisualState;
}

export function useCrossfadeVisualState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
