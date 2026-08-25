import { useEffect, useRef, type RefObject } from 'react';
import type { RepeatMode, Track } from '@home-music/shared';
import {
  configurePlaybackAudioSession,
  isAppleMobileWebKit,
  resolveBackgroundAutoAdvance
} from './background-playback';

type BackgroundPlaybackContinuityOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  queue: Track[];
  currentIndex: number;
  currentTrackId: string | null;
  repeatMode: RepeatMode;
  playing: boolean;
  onNext: () => void;
};

export function useBackgroundPlaybackContinuity({
  audioRef,
  queue,
  currentIndex,
  currentTrackId,
  repeatMode,
  playing,
  onNext
}: BackgroundPlaybackContinuityOptions) {
  const lastHandoffTrackRef = useRef<string | null>(null);
  const onNextRef = useRef(onNext);

  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);

  useEffect(() => {
    lastHandoffTrackRef.current = null;
  }, [currentTrackId]);

  useEffect(() => {
    configurePlaybackAudioSession(navigator);
  }, []);

  useEffect(() => {
    if (playing) configurePlaybackAudioSession(navigator);
  }, [playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackId || !isAppleMobileWebKit(navigator)) return;

    const onTimeUpdate = () => {
      if (lastHandoffTrackRef.current === currentTrackId) return;

      const nextTrackId = resolveBackgroundAutoAdvance(
        queue,
        currentIndex,
        repeatMode,
        audio.currentTime,
        audio.duration,
        document.visibilityState === 'hidden',
        playing && !audio.paused
      );

      if (!nextTrackId) return;
      lastHandoffTrackRef.current = currentTrackId;
      onNextRef.current();
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    return () => audio.removeEventListener('timeupdate', onTimeUpdate);
  }, [audioRef, currentIndex, currentTrackId, playing, queue, repeatMode]);
}
