import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared';
import { applyTvRemoteCommand } from './tv-remote-command';
import { clampTvSeek } from './tv-controls';

export type TvRemotePlaybackState = {
  trackId: string | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
};

export type TvRemoteCanonicalControls = {
  togglePlay: () => void | Promise<void>;
  previous: () => void;
  next: () => void;
  seek: (seconds: number) => void;
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
    updatedAt: now().toISOString()
  };
}

export function tvRemoteSnapshotKey(snapshot: TvRemotePlaybackSnapshot): string {
  return JSON.stringify({
    trackId: snapshot.trackId,
    title: snapshot.title,
    artist: snapshot.artist,
    playing: snapshot.playing,
    currentTime: Math.round(snapshot.currentTime),
    duration: Math.round(snapshot.duration)
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
    seekBy: deltaSeconds => controls.seek(clampTvSeek(playback.currentTime, playback.duration, deltaSeconds))
  });
}
