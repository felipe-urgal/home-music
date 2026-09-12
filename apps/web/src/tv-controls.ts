export const TV_SEEK_STEP_SECONDS = 10;
export const TV_VOLUME_STEP = 0.1;
export const TV_CROSSFADE_PRESETS = [0, 10, 20, 30] as const;

export function clampTvSeek(currentTime: number, duration: number, deltaSeconds: number) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrent = Number.isFinite(currentTime) ? currentTime : 0;
  return Math.max(0, Math.min(safeDuration, safeCurrent + deltaSeconds));
}

export function stepTvVolume(volume: number, delta: number) {
  const safeVolume = Number.isFinite(volume) ? volume : 0;
  return Math.max(0, Math.min(1, Math.round((safeVolume + delta) * 100) / 100));
}

export function tvCrossfadeOptions(_current: number) {
  return [...TV_CROSSFADE_PRESETS];
}
