import { useEffect, useRef, type RefObject } from 'react';
import type { RepeatMode, Track } from '@home-music/shared';
import {
  configurePlaybackAudioSession,
  isAppleMobileWebKit,
  resolveBackgroundAutoAdvance
} from './background-playback';
import {
  recordPlaybackDiagnostic,
  snapshotPlaybackAudio
} from './playback-diagnostics';

type BackgroundPlaybackContinuityOptions = {
  audioRef: RefObject<HTMLAudioElement | null>;
  queue: Track[];
  currentIndex: number;
  currentTrackId: string | null;
  repeatMode: RepeatMode;
  playing: boolean;
  onNext: () => void;
};

const DIAGNOSTIC_AUDIO_EVENTS = [
  'waiting',
  'stalled',
  'suspend',
  'emptied',
  'abort',
  'error',
  'pause',
  'ended',
  'playing'
] as const;

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
    if (!playing || !isAppleMobileWebKit(navigator)) return;
    const configured = configurePlaybackAudioSession(navigator);
    const audio = audioRef.current;
    recordPlaybackDiagnostic({
      event: 'audio-session-configure',
      visibilityState: document.visibilityState,
      trackId: currentTrackId,
      reactPlaying: playing,
      audio: audio ? snapshotPlaybackAudio(audio) : null,
      detail: configured ? 'playback' : 'unavailable'
    });
  }, [audioRef, currentTrackId, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrackId || !isAppleMobileWebKit(navigator)) return;

    const record = (event: string, detail: string | null = null) => {
      recordPlaybackDiagnostic({
        event,
        visibilityState: document.visibilityState,
        trackId: currentTrackId,
        reactPlaying: playing,
        audio: snapshotPlaybackAudio(audio),
        detail
      });
    };

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
      record('background-handoff', `next-track:${nextTrackId}`);
      onNextRef.current();
    };

    const onAudioEvent = (event: Event) => {
      if (event.type === 'playing') configurePlaybackAudioSession(navigator);
      record(`audio:${event.type}`);
    };
    const onVisibilityChange = () => {
      if (playing) configurePlaybackAudioSession(navigator);
      record('document:visibilitychange');
    };
    const onPageShow = () => {
      if (playing) configurePlaybackAudioSession(navigator);
      record('window:pageshow');
    };
    const onPageHide = () => record('window:pagehide');

    audio.addEventListener('timeupdate', onTimeUpdate);
    for (const eventName of DIAGNOSTIC_AUDIO_EVENTS) {
      audio.addEventListener(eventName, onAudioEvent);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    record('continuity:attached');

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      for (const eventName of DIAGNOSTIC_AUDIO_EVENTS) {
        audio.removeEventListener(eventName, onAudioEvent);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [audioRef, currentIndex, currentTrackId, playing, queue, repeatMode]);
}
