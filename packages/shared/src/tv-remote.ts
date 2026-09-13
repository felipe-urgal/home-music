import type {
  RepeatMode,
  TvRemoteCommand as LegacyTvRemoteCommand,
  TvRemotePlaybackSnapshot as LegacyTvRemotePlaybackSnapshot
} from './index.js';

export type TvRemotePlaybackSnapshot = LegacyTvRemotePlaybackSnapshot & {
  shuffle?: boolean;
  repeatMode?: RepeatMode;
};

export type TvRemoteCommand =
  | LegacyTvRemoteCommand
  | { type: 'toggle-shuffle' }
  | { type: 'cycle-repeat' }
  | { type: 'play-track'; trackId: string };

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'remote-connected'; data: Record<string, never> }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };
