import type { RepeatMode } from './index.js';

export type TvRemoteCommand =
  | { type: 'set-crossfade'; seconds: number }
  | { type: 'toggle-play' }
  | { type: 'previous' }
  | { type: 'next' }
  | { type: 'seek'; deltaSeconds: -10 | 10 }
  | { type: 'seek-to'; seconds: number }
  | { type: 'toggle-shuffle' }
  | { type: 'cycle-repeat' }
  | { type: 'play-track'; trackId: string };

export type TvRemotePeerRole = 'tv' | 'remote';

export type TvRemoteSignal =
  | {
      from: TvRemotePeerRole;
      type: 'description';
      description: { type: 'offer' | 'answer'; sdp: string };
    }
  | {
      from: TvRemotePeerRole;
      type: 'ice-candidate';
      candidate: {
        candidate: string;
        sdpMid: string | null;
        sdpMLineIndex: number | null;
        usernameFragment?: string | null;
      };
    };

export type TvRemotePlaybackSnapshot = {
  trackId: string | null;
  title: string | null;
  artist: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  updatedAt: string;
  crossfadeSeconds?: number;
  lastAppliedCrossfadeCommandId?: number;
  shuffle?: boolean;
  repeatMode?: RepeatMode;
};

export type TvRemoteSessionSummary = {
  capabilities?: { crossfadeControl: true };
  id: string;
  expiresAt: string;
  snapshot: TvRemotePlaybackSnapshot | null;
};

export type TvRemoteEvent =
  | { id: number; type: 'command'; data: TvRemoteCommand }
  | { id: number; type: 'snapshot'; data: TvRemotePlaybackSnapshot }
  | { id: number; type: 'remote-connected'; data: Record<string, never> }
  | { id: number; type: 'signal'; data: TvRemoteSignal }
  | { id: number; type: 'closed'; data: { reason: 'closed' | 'expired' } };

export const TV_REMOTE_CROSSFADE_MAX_SECONDS = 30;
export const TV_REMOTE_SIGNAL_MAX_SDP_LENGTH = 256 * 1024;
export const TV_REMOTE_SIGNAL_MAX_CANDIDATE_LENGTH = 8 * 1024;
export const TV_REMOTE_SIGNAL_MAX_ICE_FIELD_LENGTH = 256;

export function isTvRemoteCrossfadeSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= 0 && value <= TV_REMOTE_CROSSFADE_MAX_SECONDS;
}

export function hasTvRemoteCrossfadePair<T extends { crossfadeSeconds?: unknown; lastAppliedCrossfadeCommandId?: unknown }>(value: T): value is T & { crossfadeSeconds: number; lastAppliedCrossfadeCommandId: number } {
  return isTvRemoteCrossfadeSeconds(value.crossfadeSeconds)
    && typeof value.lastAppliedCrossfadeCommandId === 'number'
    && Number.isSafeInteger(value.lastAppliedCrossfadeCommandId)
    && value.lastAppliedCrossfadeCommandId >= 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every(key => allowed.includes(key));
}

function isLimitedNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

export function isTvRemoteSignal(value: unknown): value is TvRemoteSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signal = value as Record<string, unknown>;
  if ((signal.from !== 'tv' && signal.from !== 'remote') || typeof signal.type !== 'string') return false;

  if (signal.type === 'description') {
    if (!hasOnlyKeys(signal, ['from', 'type', 'description'])
      || !signal.description || typeof signal.description !== 'object' || Array.isArray(signal.description)) return false;
    const description = signal.description as Record<string, unknown>;
    return hasOnlyKeys(description, ['type', 'sdp'])
      && (description.type === 'offer' || description.type === 'answer')
      && typeof description.sdp === 'string'
      && description.sdp.length > 0
      && description.sdp.length <= TV_REMOTE_SIGNAL_MAX_SDP_LENGTH;
  }

  if (signal.type === 'ice-candidate') {
    if (!hasOnlyKeys(signal, ['from', 'type', 'candidate'])
      || !signal.candidate || typeof signal.candidate !== 'object' || Array.isArray(signal.candidate)) return false;
    const candidate = signal.candidate as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (keys.some(key => !['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'].includes(key))
      || !keys.includes('candidate') || !keys.includes('sdpMid') || !keys.includes('sdpMLineIndex')) return false;
    return typeof candidate.candidate === 'string'
      && candidate.candidate.length <= TV_REMOTE_SIGNAL_MAX_CANDIDATE_LENGTH
      && isLimitedNullableString(candidate.sdpMid, TV_REMOTE_SIGNAL_MAX_ICE_FIELD_LENGTH)
      && (candidate.sdpMLineIndex === null || (
        typeof candidate.sdpMLineIndex === 'number'
        && Number.isSafeInteger(candidate.sdpMLineIndex)
        && candidate.sdpMLineIndex >= 0
        && candidate.sdpMLineIndex <= 65_535
      ))
      && (candidate.usernameFragment === undefined
        || isLimitedNullableString(candidate.usernameFragment, TV_REMOTE_SIGNAL_MAX_ICE_FIELD_LENGTH));
  }

  return false;
}
