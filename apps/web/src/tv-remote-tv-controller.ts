import type { RepeatMode } from '@home-music/shared';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import { applyTvRemoteCommand } from './tv-remote-command';
import { clampTvSeek } from './tv-controls';

export type TvRemotePlaybackState = {
  trackId: string | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  shuffle?: boolean;
  repeatMode?: RepeatMode;
};

export type TvRemoteCanonicalControls = {
  togglePlay: () => void | Promise<void>;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  playTrack: (trackId: string) => void;
};

export function tvRemoteSnapshot(
  state: TvRemotePlaybackState,
  now: () => Date = () => new Date()
): TvRemotePlaybackSnapshot {
  const duration = Number.isFinite(state.duration) ? Math.max(0, state.duration) : 0;
  const currentTime = Number.isFinite(state.currentTime) ? Math.max(0, state.currentTime) : 0;
  return {
    trackId: state.trackId,
    title: state.title,
    artist: state.artist,
    playing: state.playing,
    currentTime: duration > 0 ? Math.min(currentTime, duration) : currentTime,
    duration,
    updatedAt: now().toISOString(),
    ...(state.shuffle === undefined ? {} : { shuffle: state.shuffle }),
    ...(state.repeatMode === undefined ? {} : { repeatMode: state.repeatMode })
  };
}

export function tvRemoteSnapshotKey(snapshot: TvRemotePlaybackSnapshot): string {
  return JSON.stringify({
    trackId: snapshot.trackId,
    title: snapshot.title,
    artist: snapshot.artist,
    playing: snapshot.playing,
    currentTime: Math.round(snapshot.currentTime),
    duration: Math.round(snapshot.duration),
    shuffle: snapshot.shuffle ?? false,
    repeatMode: snapshot.repeatMode ?? 'off'
  });
}

export function applyTvRemotePlayerCommand(
  command: TvRemoteCommand,
  playback: Pick<TvRemotePlaybackState, 'currentTime' | 'duration'>,
  controls: TvRemoteCanonicalControls
): void {
  applyTvRemoteCommand(command, {
    togglePlay: controls.togglePlay,
    previous: controls.previous,
    next: controls.next,
    seekBy: deltaSeconds => controls.seek(clampTvSeek(playback.currentTime, playback.duration, deltaSeconds)),
    toggleShuffle: controls.toggleShuffle,
    cycleRepeatMode: controls.cycleRepeatMode,
    playTrack: controls.playTrack
  });
}
