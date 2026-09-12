import { useSyncExternalStore } from 'react';
import type { Track } from '@home-music/shared';

export type CrossfadeVisualState = {
  attempt: number;
  originTrackId: string;
  incomingTrack: Track;
  durationSeconds: number;
  elapsedSeconds: number;
};

let crossfadeVisualState: CrossfadeVisualState | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function setCrossfadeVisualState(nextState: CrossfadeVisualState) {
  crossfadeVisualState = nextState;
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
