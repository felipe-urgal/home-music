export const TV_REMOTE_MEDIA_CHUNK_BYTES = 64 * 1024;
export const TV_REMOTE_MEDIA_MAX_BYTES = 256 * 1024 * 1024;
const BUFFER_HIGH_WATER = 1024 * 1024;
const BUFFER_LOW_WATER = 512 * 1024;
const ACK_TIMEOUT_MS = 30_000;
const MAX_ID_LENGTH = 1024;
const MAX_MIME_LENGTH = 128;

export type TvRemoteMediaControl =
  | { type: 'media-start'; transferId: string; trackId: string; mimeType: string; size: number }
  | { type: 'media-complete'; transferId: string }
  | { type: 'media-ready'; transferId: string; trackId: string }
  | { type: 'media-cancel'; transferId: string; reason?: string };

export type TvRemoteReceivedMedia = {
  trackId: string;
  transferId: string;
  blob: Blob;
  mimeType: string;
  size: number;
};

type IncomingTransfer = {
  transferId: string;
  trackId: string;
  mimeType: string;
  size: number;
  received: number;
  parts: BlobPart[];
};

type PendingSend = {
  transferId: string;
  trackId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: number;
};

export type TvRemoteMediaEndpoint = {
  send: (input: { trackId: string; blob: Blob; mimeType?: string }, onProgress?: (sent: number, total: number) => void) => Promise<void>;
  cancel: (reason?: string) => void;
  close: () => void;
};

type EndpointOptions = {
  onReceive?: (media: TvRemoteReceivedMedia) => void | Promise<void>;
  createTransferId?: () => string;
  setTimeout?: typeof window.setTimeout;
  clearTimeout?: typeof window.clearTimeout;
};

function validId(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function validMime(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_MIME_LENGTH && value.startsWith('audio/');
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

export function parseTvRemoteMediaControl(value: unknown): TvRemoteMediaControl | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type === 'media-start') {
    if (!exactKeys(message, ['type', 'transferId', 'trackId', 'mimeType', 'size'])) return null;
    return validId(message.transferId) && validId(message.trackId) && validMime(message.mimeType)
      && typeof message.size === 'number' && Number.isSafeInteger(message.size)
      && message.size > 0 && message.size <= TV_REMOTE_MEDIA_MAX_BYTES
      ? message as TvRemoteMediaControl
      : null;
  }
  if (message.type === 'media-complete') {
    return exactKeys(message, ['type', 'transferId']) && validId(message.transferId)
      ? message as TvRemoteMediaControl
      : null;
  }
  if (message.type === 'media-ready') {
    return exactKeys(message, ['type', 'transferId', 'trackId']) && validId(message.transferId) && validId(message.trackId)
      ? message as TvRemoteMediaControl
      : null;
  }
  if (message.type === 'media-cancel') {
    const allowed = message.reason === undefined
      ? exactKeys(message, ['type', 'transferId'])
      : exactKeys(message, ['type', 'transferId', 'reason']);
    return allowed && validId(message.transferId)
      && (message.reason === undefined || (typeof message.reason === 'string' && message.reason.length <= 512))
      ? message as TvRemoteMediaControl
      : null;
  }
  return null;
}

function encodeControl(message: TvRemoteMediaControl) {
  return JSON.stringify(message);
}

function defaultTransferId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function mediaError(message: string) {
  return new Error(message);
}

function normalizeBinary(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  }
  return null;
}

async function waitForWritable(channel: RTCDataChannel) {
  if (channel.readyState !== 'open') throw mediaError('A conexão P2P com a TV foi encerrada.');
  if (channel.bufferedAmount <= BUFFER_HIGH_WATER) return;
  channel.bufferedAmountLowThreshold = BUFFER_LOW_WATER;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener('bufferedamountlow', onLow);
      channel.removeEventListener('close', onClose);
    };
    const onLow = () => { cleanup(); resolve(); };
    const onClose = () => { cleanup(); reject(mediaError('A conexão P2P com a TV foi encerrada.')); };
    channel.addEventListener('bufferedamountlow', onLow);
    channel.addEventListener('close', onClose);
  });
}

export function createTvRemoteMediaEndpoint(channel: RTCDataChannel, options: EndpointOptions = {}): TvRemoteMediaEndpoint {
  channel.binaryType = 'arraybuffer';
  const createTransferId = options.createTransferId ?? defaultTransferId;
  const scheduleTimeout = options.setTimeout ?? window.setTimeout.bind(window);
  const cancelTimeout = options.clearTimeout ?? window.clearTimeout.bind(window);
  let incoming: IncomingTransfer | null = null;
  let pending: PendingSend | null = null;
  let closed = false;

  const sendControl = (message: TvRemoteMediaControl) => {
    if (closed || channel.readyState !== 'open') return false;
    channel.send(encodeControl(message));
    return true;
  };

  const rejectPending = (error: Error) => {
    const current = pending;
    pending = null;
    if (!current) return;
    cancelTimeout(current.timeout);
    current.reject(error);
  };

  const clearIncoming = () => { incoming = null; };

  const cancelIncoming = (reason: string) => {
    const current = incoming;
    incoming = null;
    if (current) sendControl({ type: 'media-cancel', transferId: current.transferId, reason });
  };

  const handleControl = async (message: TvRemoteMediaControl) => {
    if (message.type === 'media-start') {
      if (incoming) cancelIncoming('Nova transferência iniciada.');
      incoming = {
        transferId: message.transferId,
        trackId: message.trackId,
        mimeType: message.mimeType,
        size: message.size,
        received: 0,
        parts: []
      };
      return;
    }

    if (message.type === 'media-cancel') {
      if (incoming?.transferId === message.transferId) clearIncoming();
      if (pending?.transferId === message.transferId) rejectPending(mediaError(message.reason || 'Transferência cancelada pela TV.'));
      return;
    }

    if (message.type === 'media-ready') {
      if (!pending || pending.transferId !== message.transferId || pending.trackId !== message.trackId) return;
      const current = pending;
      pending = null;
      cancelTimeout(current.timeout);
      current.resolve();
      return;
    }

    if (!incoming || incoming.transferId !== message.transferId) return;
    const completed = incoming;
    clearIncoming();
    if (completed.received !== completed.size) {
      sendControl({ type: 'media-cancel', transferId: completed.transferId, reason: 'Tamanho recebido não confere.' });
      return;
    }

    try {
      const blob = new Blob(completed.parts, { type: completed.mimeType });
      if (blob.size !== completed.size) throw mediaError('Tamanho recebido não confere.');
      await options.onReceive?.({
        trackId: completed.trackId,
        transferId: completed.transferId,
        blob,
        mimeType: completed.mimeType,
        size: completed.size
      });
      sendControl({ type: 'media-ready', transferId: completed.transferId, trackId: completed.trackId });
    } catch (error) {
      sendControl({
        type: 'media-cancel',
        transferId: completed.transferId,
        reason: error instanceof Error ? error.message.slice(0, 512) : 'Falha ao preparar mídia recebida.'
      });
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (closed) return;
    if (typeof event.data === 'string') {
      try {
        const message = parseTvRemoteMediaControl(JSON.parse(event.data) as unknown);
        if (message) void handleControl(message);
      } catch {
        // Mensagem textual fora do protocolo é ignorada.
      }
      return;
    }

    const chunk = normalizeBinary(event.data);
    if (!chunk || !incoming) return;
    if (incoming.received + chunk.byteLength > incoming.size || incoming.received + chunk.byteLength > TV_REMOTE_MEDIA_MAX_BYTES) {
      cancelIncoming('Transferência excedeu o tamanho anunciado.');
      return;
    }
    incoming.parts.push(chunk);
    incoming.received += chunk.byteLength;
  };

  const onClose = () => {
    closed = true;
    clearIncoming();
    rejectPending(mediaError('A conexão P2P com a TV foi encerrada.'));
  };

  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', onClose);

  return {
    send: async (input, onProgress) => {
      if (closed || channel.readyState !== 'open') throw mediaError('A conexão P2P com a TV ainda não está pronta.');
      if (pending) throw mediaError('Já existe uma música sendo enviada para a TV.');
      const mimeType = (input.mimeType || input.blob.type).split(';')[0]?.trim() ?? '';
      if (!validId(input.trackId)) throw mediaError('Identificador de música inválido.');
      if (!validMime(mimeType)) throw mediaError('Formato de áudio inválido para transmissão.');
      if (!Number.isSafeInteger(input.blob.size) || input.blob.size <= 0 || input.blob.size > TV_REMOTE_MEDIA_MAX_BYTES) {
        throw mediaError('A música excede o limite de transmissão para a TV.');
      }

      const transferId = createTransferId();
      if (!validId(transferId)) throw mediaError('Identificador de transferência inválido.');
      sendControl({ type: 'media-start', transferId, trackId: input.trackId, mimeType, size: input.blob.size });

      let sent = 0;
      try {
        while (sent < input.blob.size) {
          await waitForWritable(channel);
          const end = Math.min(input.blob.size, sent + TV_REMOTE_MEDIA_CHUNK_BYTES);
          const chunk = await input.blob.slice(sent, end).arrayBuffer();
          if (closed || channel.readyState !== 'open') throw mediaError('A conexão P2P com a TV foi encerrada.');
          channel.send(chunk);
          sent = end;
          onProgress?.(sent, input.blob.size);
        }
      } catch (error) {
        sendControl({ type: 'media-cancel', transferId, reason: 'Envio interrompido.' });
        throw error;
      }

      const confirmation = new Promise<void>((resolve, reject) => {
        const timeout = scheduleTimeout(() => {
          if (pending?.transferId !== transferId) return;
          pending = null;
          reject(mediaError('A TV não confirmou o recebimento da música.'));
        }, ACK_TIMEOUT_MS);
        pending = { transferId, trackId: input.trackId, resolve, reject, timeout };
      });
      if (!sendControl({ type: 'media-complete', transferId })) {
        rejectPending(mediaError('A conexão P2P com a TV foi encerrada.'));
      }
      await confirmation;
    },
    cancel: reason => {
      if (pending) {
        const transferId = pending.transferId;
        sendControl({ type: 'media-cancel', transferId, ...(reason ? { reason: reason.slice(0, 512) } : {}) });
        rejectPending(mediaError(reason || 'Transferência cancelada.'));
      }
      if (incoming) cancelIncoming(reason || 'Transferência cancelada.');
    },
    close: () => {
      if (closed) return;
      closed = true;
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
      clearIncoming();
      rejectPending(mediaError('A conexão P2P com a TV foi encerrada.'));
    }
  };
}
