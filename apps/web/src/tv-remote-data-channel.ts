import {
  isTvRemoteCrossfadeSeconds,
  type TvRemoteCommand,
  type TvRemotePlaybackSnapshot
} from '@home-music/shared/tv-remote';
import {
  createTvRemoteMediaEndpoint,
  type TvRemoteMediaEndpoint,
  type TvRemoteReceivedMedia
} from './tv-remote-media';

export const TV_REMOTE_DATA_VERSION = 'home-music-data-v1' as const;
const MAX_MESSAGE_ID_LENGTH = 128;
const MAX_TEXT_LENGTH = 1024;
const MAX_SEEN_MESSAGES = 512;

export type TvRemoteTrackMetadata = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
};

type TvRemoteDataFrame =
  | { version: typeof TV_REMOTE_DATA_VERSION; id: string; kind: 'command'; payload: TvRemoteCommand }
  | { version: typeof TV_REMOTE_DATA_VERSION; id: string; kind: 'snapshot'; payload: TvRemotePlaybackSnapshot }
  | { version: typeof TV_REMOTE_DATA_VERSION; id: string; kind: 'track-metadata'; payload: TvRemoteTrackMetadata }
  | { version: typeof TV_REMOTE_DATA_VERSION; id: string; kind: 'disconnect'; payload: { reason: string } }
  | { version: typeof TV_REMOTE_DATA_VERSION; id: string; kind: 'error'; payload: { code: string; message: string } };

export type TvRemoteDataChannel = {
  media: TvRemoteMediaEndpoint;
  sendCommand: (command: TvRemoteCommand) => void;
  sendSnapshot: (snapshot: TvRemotePlaybackSnapshot) => void;
  sendTrackAndPlay: (
    input: { trackId: string; blob: Blob; mimeType?: string; metadata?: TvRemoteTrackMetadata },
    onProgress?: (sent: number, total: number) => void
  ) => Promise<void>;
  disconnect: (reason?: string) => void;
  close: () => void;
};

type DataChannelOptions = {
  onCommand?: (command: TvRemoteCommand) => void;
  onSnapshot?: (snapshot: TvRemotePlaybackSnapshot) => void;
  onTrackMetadata?: (metadata: TvRemoteTrackMetadata) => void;
  onMedia?: (media: TvRemoteReceivedMedia) => void | Promise<void>;
  onDisconnect?: (reason: string) => void;
  onError?: (error: Error) => void;
  createMessageId?: () => string;
  createTransferId?: () => string;
  setTimeout?: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
};

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function validId(value: unknown) {
  return typeof value === 'string' && value.length >= 8 && value.length <= MAX_MESSAGE_ID_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function validText(value: unknown, nullable = false): value is string | null {
  return (nullable && value === null) || (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH);
}

function parseCommand(value: unknown): TvRemoteCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = value as Record<string, unknown>;
  if (['toggle-play', 'previous', 'next', 'toggle-shuffle', 'cycle-repeat'].includes(String(command.type))) {
    return exactKeys(command, ['type']) ? command as TvRemoteCommand : null;
  }
  if (command.type === 'seek') {
    return exactKeys(command, ['type', 'deltaSeconds']) && (command.deltaSeconds === -10 || command.deltaSeconds === 10)
      ? command as TvRemoteCommand : null;
  }
  if (command.type === 'seek-to') {
    return exactKeys(command, ['type', 'seconds']) && typeof command.seconds === 'number'
      && Number.isFinite(command.seconds) && command.seconds >= 0
      ? command as TvRemoteCommand
      : null;
  }
  if (command.type === 'set-crossfade') {
    return exactKeys(command, ['type', 'seconds']) && isTvRemoteCrossfadeSeconds(command.seconds)
      ? command as TvRemoteCommand : null;
  }
  if (command.type === 'play-track') {
    return exactKeys(command, ['type', 'trackId']) && typeof command.trackId === 'string'
      && command.trackId.length > 0 && command.trackId.length <= MAX_TEXT_LENGTH
      ? command as TvRemoteCommand : null;
  }
  return null;
}

function parseSnapshot(value: unknown): TvRemotePlaybackSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const allowed = ['trackId', 'title', 'artist', 'playing', 'currentTime', 'duration', 'updatedAt',
    'crossfadeSeconds', 'lastAppliedCrossfadeCommandId', 'shuffle', 'repeatMode'];
  if (Object.keys(snapshot).some(key => !allowed.includes(key))) return null;
  if (!validText(snapshot.trackId, true) || !validText(snapshot.title, true) || !validText(snapshot.artist, true)) return null;
  if (typeof snapshot.playing !== 'boolean' || typeof snapshot.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(snapshot.updatedAt))) return null;
  if (typeof snapshot.currentTime !== 'number' || !Number.isFinite(snapshot.currentTime) || snapshot.currentTime < 0) return null;
  if (typeof snapshot.duration !== 'number' || !Number.isFinite(snapshot.duration) || snapshot.duration < 0) return null;
  if (snapshot.shuffle !== undefined && typeof snapshot.shuffle !== 'boolean') return null;
  if (snapshot.repeatMode !== undefined && !['off', 'all', 'one'].includes(String(snapshot.repeatMode))) return null;
  if (snapshot.crossfadeSeconds !== undefined && !isTvRemoteCrossfadeSeconds(snapshot.crossfadeSeconds)) return null;
  if (snapshot.lastAppliedCrossfadeCommandId !== undefined
    && (typeof snapshot.lastAppliedCrossfadeCommandId !== 'number'
      || !Number.isSafeInteger(snapshot.lastAppliedCrossfadeCommandId)
      || snapshot.lastAppliedCrossfadeCommandId < 0)) return null;
  return snapshot as TvRemotePlaybackSnapshot;
}

function parseTrackMetadata(value: unknown): TvRemoteTrackMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = value as Record<string, unknown>;
  if (!exactKeys(metadata, ['trackId', 'title', 'artist', 'album'])) return null;
  if (!validText(metadata.trackId) || !metadata.trackId) return null;
  if (!validText(metadata.title) || !validText(metadata.artist) || !validText(metadata.album)) return null;
  return metadata as TvRemoteTrackMetadata;
}

export function parseTvRemoteDataFrame(value: unknown): TvRemoteDataFrame | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const frame = value as Record<string, unknown>;
  if (!exactKeys(frame, ['version', 'id', 'kind', 'payload'])
    || frame.version !== TV_REMOTE_DATA_VERSION || !validId(frame.id)) return null;
  if (frame.kind === 'command') {
    const payload = parseCommand(frame.payload);
    return payload ? { version: TV_REMOTE_DATA_VERSION, id: frame.id as string, kind: 'command', payload } : null;
  }
  if (frame.kind === 'snapshot') {
    const payload = parseSnapshot(frame.payload);
    return payload ? { version: TV_REMOTE_DATA_VERSION, id: frame.id as string, kind: 'snapshot', payload } : null;
  }
  if (frame.kind === 'track-metadata') {
    const payload = parseTrackMetadata(frame.payload);
    return payload ? { version: TV_REMOTE_DATA_VERSION, id: frame.id as string, kind: 'track-metadata', payload } : null;
  }
  if (frame.kind === 'disconnect') {
    const payload = frame.payload as Record<string, unknown> | null;
    return payload && exactKeys(payload, ['reason']) && validText(payload.reason)
      ? { version: TV_REMOTE_DATA_VERSION, id: frame.id as string, kind: 'disconnect', payload: { reason: payload.reason as string } }
      : null;
  }
  if (frame.kind === 'error') {
    const payload = frame.payload as Record<string, unknown> | null;
    return payload && exactKeys(payload, ['code', 'message']) && validText(payload.code) && validText(payload.message)
      ? { version: TV_REMOTE_DATA_VERSION, id: frame.id as string, kind: 'error', payload: { code: payload.code as string, message: payload.message as string } }
      : null;
  }
  return null;
}

function defaultMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `message_${Date.now().toString(36)}_${Math.random().toString(36).slice(2).padEnd(8, '0')}`;
}

export function createTvRemoteDataChannel(channel: RTCDataChannel, options: DataChannelOptions = {}): TvRemoteDataChannel {
  const createMessageId = options.createMessageId ?? defaultMessageId;
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  let closed = false;

  const media = createTvRemoteMediaEndpoint(channel, {
    onReceive: options.onMedia,
    createTransferId: options.createTransferId,
    setTimeout: options.setTimeout,
    clearTimeout: options.clearTimeout
  });

  const send = (kind: TvRemoteDataFrame['kind'], payload: TvRemoteDataFrame['payload']) => {
    if (closed || channel.readyState !== 'open') throw new Error('A conexão P2P com a TV foi encerrada.');
    const frame = { version: TV_REMOTE_DATA_VERSION, id: createMessageId(), kind, payload };
    if (!parseTvRemoteDataFrame(frame)) throw new Error('Mensagem P2P inválida.');
    channel.send(JSON.stringify(frame));
  };

  const onMessage = (event: MessageEvent) => {
    if (closed || typeof event.data !== 'string') return;
    try {
      const frame = parseTvRemoteDataFrame(JSON.parse(event.data) as unknown);
      if (!frame || seen.has(frame.id)) return;
      seen.add(frame.id);
      seenOrder.push(frame.id);
      while (seenOrder.length > MAX_SEEN_MESSAGES) {
        const oldest = seenOrder.shift();
        if (oldest) seen.delete(oldest);
      }
      if (frame.kind === 'command') options.onCommand?.(frame.payload);
      else if (frame.kind === 'snapshot') options.onSnapshot?.(frame.payload);
      else if (frame.kind === 'track-metadata') options.onTrackMetadata?.(frame.payload);
      else if (frame.kind === 'disconnect') options.onDisconnect?.(frame.payload.reason);
      else options.onError?.(new Error(frame.payload.message));
    } catch {
      // Media controls and malformed peer messages are handled or ignored elsewhere.
    }
  };
  channel.addEventListener('message', onMessage);

  const close = () => {
    if (closed) return;
    closed = true;
    channel.removeEventListener('message', onMessage);
    media.close();
    seen.clear();
    seenOrder.length = 0;
  };

  return {
    media,
    sendCommand: command => send('command', command),
    sendSnapshot: value => send('snapshot', value),
    sendTrackAndPlay: async (input, onProgress) => {
      if (input.metadata) {
        if (input.metadata.trackId !== input.trackId) throw new Error('Metadados da música não correspondem ao áudio.');
        send('track-metadata', input.metadata);
      }
      await media.send(input, onProgress);
      send('command', { type: 'play-track', trackId: input.trackId });
    },
    disconnect: reason => send('disconnect', { reason: reason ?? 'closed' }),
    close
  };
}
