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
  const nextIndex = currentIndex + 1;
  return nextIndex >= 0 && nextIndex < length ? nextIndex : null;
}
