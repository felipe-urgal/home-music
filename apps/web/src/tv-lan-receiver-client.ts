import { isTvLanSignalEnvelope, TV_LAN_REMOTE_VERSION, type TvLanSignalEnvelope } from '@home-music/shared/tv-lan-remote';
import type { TvRemoteSignal } from '@home-music/shared/tv-remote';

export type TvLanReceiverBootstrap = {
  version: typeof TV_LAN_REMOTE_VERSION;
  sessionId: string;
  sessionToken: string;
  expiresAt: number;
  signalingBase: string;
};

type FetchLike = typeof fetch;

type ReceiverSignalingOptions = {
  fetchImpl?: FetchLike;
  pollDelayMs?: number;
  createMessageId?: () => string;
};

export type TvLanReceiverSignaling = {
  bootstrap: TvLanReceiverBootstrap;
  sendSignal: (signal: TvRemoteSignal) => Promise<void>;
  start: (onSignal: (signal: TvRemoteSignal) => void | Promise<void>, onError?: (error: Error) => void) => void;
  finish: () => void;
  close: () => void;
};

function isToken(value: unknown) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 192 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function parseTvLanReceiverBootstrap(value: unknown): TvLanReceiverBootstrap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== 5 || !keys.every(key => ['version', 'sessionId', 'sessionToken', 'expiresAt', 'signalingBase'].includes(key))) return null;
  if (input.version !== TV_LAN_REMOTE_VERSION || !isToken(input.sessionId) || !isToken(input.sessionToken)) return null;
  if (typeof input.expiresAt !== 'number' || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now()) return null;
  if (typeof input.signalingBase !== 'string') return null;
  try {
    const url = new URL(input.signalingBase);
    if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) return null;
  } catch {
    return null;
  }
  return input as TvLanReceiverBootstrap;
}

function defaultMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const random = Math.random().toString(36).slice(2).padEnd(16, '0');
  return `message_${Date.now().toString(36)}_${random}`;
}

function receiverError(message: string) {
  return new Error(message);
}

async function readJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw receiverError('Resposta inválida do serviço local da TV.');
  }
}

export async function createTvLanReceiverSignaling(options: ReceiverSignalingOptions = {}): Promise<TvLanReceiverSignaling> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const bootstrapResponse = await fetchImpl('/receiver/bootstrap', { cache: 'no-store' });
  if (!bootstrapResponse.ok) throw receiverError('Não foi possível iniciar o receiver offline local.');
  const bootstrap = parseTvLanReceiverBootstrap(await readJson(bootstrapResponse));
  if (!bootstrap) throw receiverError('O serviço local da TV retornou um bootstrap incompatível.');

  const controller = new AbortController();
  const pollDelayMs = Math.max(100, options.pollDelayMs ?? 300);
  const createMessageId = options.createMessageId ?? defaultMessageId;
  let cursor = 0;
  let started = false;
  let finished = false;
  let closed = false;

  const authHeaders = () => ({
    Authorization: `Bearer ${bootstrap.sessionToken}`
  });

  const sendSignal = async (signal: TvRemoteSignal) => {
    if (finished) return;
    if (closed) throw receiverError('A sessão offline local foi encerrada.');
    const envelope: TvLanSignalEnvelope = {
      messageId: createMessageId(),
      from: 'tv',
      signal: { ...signal, from: 'tv' }
    };
    const response = await fetchImpl(`${bootstrap.signalingBase}/signals?role=tv`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(envelope),
      cache: 'no-store',
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 410) throw receiverError('A sessão de pareamento offline expirou.');
    if (!response.ok) throw receiverError('Falha ao enviar sinalização local da TV.');
  };

  const start = (onSignal: (signal: TvRemoteSignal) => void | Promise<void>, onError?: (error: Error) => void) => {
    if (started || closed || finished) return;
    started = true;
    const run = async () => {
      while (!closed && !finished && !controller.signal.aborted) {
        try {
          const response = await fetchImpl(
            `${bootstrap.signalingBase}/signals?role=tv&cursor=${encodeURIComponent(String(cursor))}`,
            { headers: authHeaders(), cache: 'no-store', signal: controller.signal }
          );
          if (response.status === 401 || response.status === 410) throw receiverError('A sessão de pareamento offline expirou.');
          if (!response.ok) throw receiverError('Falha ao receber sinalização local.');
          const value = await readJson(response);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw receiverError('Resposta de sinalização local inválida.');
          const poll = value as { cursor?: unknown; messages?: unknown };
          if (typeof poll.cursor !== 'number' || !Number.isSafeInteger(poll.cursor) || poll.cursor < cursor || !Array.isArray(poll.messages)) {
            throw receiverError('Cursor de sinalização local inválido.');
          }
          cursor = poll.cursor;
          for (const message of poll.messages) {
            if (!isTvLanSignalEnvelope(message) || message.from !== 'remote') continue;
            await onSignal(message.signal);
          }
        } catch (error) {
          if (closed || finished || controller.signal.aborted) return;
          onError?.(error instanceof Error ? error : receiverError('Falha na sinalização local.'));
        }
        if (closed || finished || controller.signal.aborted) return;
        await new Promise(resolve => setTimeout(resolve, pollDelayMs));
      }
    };
    void run();
  };

  return {
    bootstrap,
    sendSignal,
    start,
    finish: () => {
      if (closed || finished) return;
      finished = true;
      controller.abort();
    },
    close: () => {
      if (closed) return;
      closed = true;
      controller.abort();
    }
  };
}
