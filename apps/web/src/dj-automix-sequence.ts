export function shuffleDjTrackList<T>(
  items: readonly T[],
  random: () => number = Math.random
) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const value = Math.max(0, Math.min(0.999999999, random()));
    const swapIndex = Math.floor(value * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function nextDjAutomixIndex(length: number, currentIndex: number) {
  if (!Number.isInteger(length) || length <= 0) return null;
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return 0;
  return (currentIndex + 1) % length;
}

export function shouldRecoverDjAutomixAfterEnded(input: {
  automixActive: boolean;
  transitionActive: boolean;
  hasTrack: boolean;
  playing: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
}) {
  if (
    !input.automixActive
    || input.transitionActive
    || !input.hasTrack
    || input.playing
    || !Number.isFinite(input.currentTimeSeconds)
    || !Number.isFinite(input.durationSeconds)
    || input.durationSeconds <= 0
  ) return false;

  return input.currentTimeSeconds >= Math.max(0, input.durationSeconds - 0.15);
}


export function canPrepareDjAutomixNext(input: {
  automixActive: boolean;
  transitionActive: boolean;
  activeDeckMatches: boolean;
  queueIndexMatches: boolean;
  activeTrackMatches: boolean;
  activeDeckPlaying: boolean;
}) {
  return (
    input.automixActive
    && !input.transitionActive
    && input.activeDeckMatches
    && input.queueIndexMatches
    && input.activeTrackMatches
    && input.activeDeckPlaying
  );
}
