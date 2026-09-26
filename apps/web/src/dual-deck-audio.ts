import type { DjDeckId } from './dj-controller-contract';

export type DualDeckAudioSnapshot = {
  deck: DjDeckId;
  trackId: string | null;
  source: string | null;
  playing: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  playbackRate: number;
  volume: number;
  errorCode: number | null;
};

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clearDeckAudio(audio: HTMLAudioElement) {
  audio.pause();
  audio.volume = 0;
  audio.playbackRate = 1;
  audio.preservesPitch = true;
  audio.removeAttribute('src');
  audio.load();
}

export function loadDeckAudio(
  audio: HTMLAudioElement,
  source: string,
  options: { volume?: number } = {}
) {
  audio.pause();
  audio.playbackRate = 1;
  audio.preservesPitch = true;
  audio.volume = clampUnit(options.volume ?? 0);
  audio.src = source;
  audio.load();
}

export async function playDeckAudio(audio: HTMLAudioElement) {
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export function pauseDeckAudio(audio: HTMLAudioElement) {
  audio.pause();
}

export function seekDeckAudio(audio: HTMLAudioElement, seconds: number) {
  if (!Number.isFinite(seconds)) return audio.currentTime;
  const upperBound = Number.isFinite(audio.duration) && audio.duration >= 0
    ? audio.duration
    : Math.max(0, seconds);
  const next = Math.max(0, Math.min(seconds, upperBound));
  audio.currentTime = next;
  return next;
}

export function setDeckPlaybackRate(audio: HTMLAudioElement, playbackRate: number) {
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return audio.playbackRate;
  audio.preservesPitch = true;
  audio.playbackRate = playbackRate;
  return audio.playbackRate;
}

export function setDeckVolume(audio: HTMLAudioElement, volume: number) {
  audio.volume = clampUnit(volume);
  return audio.volume;
}

export function readDeckAudioSnapshot(
  deck: DjDeckId,
  trackId: string | null,
  audio: HTMLAudioElement
): DualDeckAudioSnapshot {
  return {
    deck,
    trackId,
    source: audio.getAttribute('src'),
    playing: !audio.paused && !audio.ended,
    currentTimeSeconds: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    durationSeconds: Number.isFinite(audio.duration) ? audio.duration : 0,
    playbackRate: Number.isFinite(audio.playbackRate) && audio.playbackRate > 0
      ? audio.playbackRate
      : 1,
    volume: clampUnit(audio.volume),
    errorCode: audio.error?.code ?? null
  };
}
