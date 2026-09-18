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

export type TvNumericShortcut = 'open-remote' | 'toggle-play' | 'next';

export function tvNumericShortcut(key: string, code = '', keyCode = 0): TvNumericShortcut | null {
  const numericKey = key === '1' || code === 'Digit1' || code === 'Numpad1' || keyCode === 49 || keyCode === 97
    ? 1
    : key === '2' || code === 'Digit2' || code === 'Numpad2' || keyCode === 50 || keyCode === 98
      ? 2
      : key === '3' || code === 'Digit3' || code === 'Numpad3' || keyCode === 51 || keyCode === 99
        ? 3
        : 0;

  if (numericKey === 1) return 'open-remote';
  if (numericKey === 2) return 'toggle-play';
  if (numericKey === 3) return 'next';
  return null;
}
