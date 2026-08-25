import type { RepeatMode, Track } from '@home-music/shared';
import { nextTrackDecision } from './player-state';

export const BACKGROUND_HANDOFF_WINDOW_SECONDS = 0.4;

type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  audioSession?: { type?: string };
};

export function isAppleMobileWebKit(navigatorLike: NavigatorLike) {
  const userAgent = navigatorLike.userAgent ?? '';
  const platform = navigatorLike.platform ?? '';
  return /iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && (navigatorLike.maxTouchPoints ?? 0) > 1);
}

export function configurePlaybackAudioSession(navigatorLike: NavigatorLike) {
  const audioSession = navigatorLike.audioSession;
  if (!audioSession) return false;

  try {
    if (audioSession.type !== 'playback') audioSession.type = 'playback';
    return audioSession.type === 'playback';
  } catch {
    return false;
  }
}

export function resolveBackgroundAutoAdvance(
  queue: Track[],
  currentIndex: number,
  repeatMode: RepeatMode,
  currentTime: number,
  duration: number,
  hidden: boolean,
  playing: boolean
) {
  if (!hidden || !playing) return null;
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return null;

  const remaining = duration - currentTime;
  if (remaining <= 0 || remaining > BACKGROUND_HANDOFF_WINDOW_SECONDS) return null;

  const decision = nextTrackDecision(queue, currentIndex, repeatMode, true);
  return decision.type === 'track' ? decision.id : null;
}
