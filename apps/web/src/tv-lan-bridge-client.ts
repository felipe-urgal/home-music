import type { TvLanQrPayload } from '@home-music/shared/tv-lan-remote';
import {
  TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS,
  createTvLanBridgeId,
  createTvLanBridgeRequest,
  isExpectedTvLanBridgeEvent,
  isMatchingTvLanBridgeResponse,
  parseTvLanBridgeMessage,
  type TvLanBridgeOperation,
  type TvLanBridgeResponseMessage,
} from './tv-lan-bridge-protocol';
import type { TvLanTransport, TvLanTransportResponse } from './tv-lan-transport';

type WindowLike = Pick<Window, 'location' | 'open' | 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout'>;

type BridgeClientOptions = {
  signal?: AbortSignal;
  requestTimeoutMs?: number;
  windowImpl?: WindowLike;
};

type PendingRequest = {
  operation: TvLanBridgeOperation;
  resolve: (value: TvLanTransportResponse) => void;
  reject: (error: Error) => void;
  timeout: number;
};

function bridgeError(message: string) {
  return new Error(message);
}

function relayPayload(message: TvLanBridgeResponseMessage): TvLanTransportResponse | null {
  const value = message.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as { status?: unknown; body?: unknown };
  if (typeof payload.status !== 'number' || !Number.isSafeInteger(payload.status) || payload.status < 100 || payload.status > 599) return null;
  return { status: payload.status, body: payload.body };
}

function bridgeResponseError(message: TvLanBridgeResponseMessage) {
  if (message.error === 'timeout') return bridgeError('A TV não respondeu a tempo pelo bridge local.');
  if (message.error === 'network_error') return bridgeError('O bridge não conseguiu alcançar o serviço LAN da TV.');
  if (message.error === 'invalid_payload') return bridgeError('O bridge recusou uma request LAN inválida.');
  if (message.error === 'duplicate_request') return bridgeError('O bridge recebeu uma request LAN duplicada.');
  if (message.error === 'invalid_response') return bridgeError('O bridge recebeu uma resposta LAN inválida da TV.');
  if (message.error === 'response_too_large') return bridgeError('A resposta LAN da TV excedeu o limite do bridge.');
  return bridgeError(`O bridge respondeu com erro: ${message.error ?? 'unknown_error'}.`);
}

export async function createTvLanBridgeTransport(
  pairing: TvLanQrPayload,
  options: BridgeClientOptions = {},
): Promise<TvLanTransport> {
  const windowImpl = options.windowImpl ?? window;
  const bridgeOrigin = `http://${pairing.host}:${pairing.port}`;
  const channelId = createTvLanBridgeId();
  const requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? TV_LAN_BRIDGE_REQUEST_TIMEOUT_MS);
  const bridgeUrl = `${bridgeOrigin}/bridge?origin=${encodeURIComponent(windowImpl.location.origin)}&channelId=${encodeURIComponent(channelId)}`;
  const bridgeWindow = windowImpl.open(bridgeUrl, 'home-music-ios-lan-bridge');
  if (!bridgeWindow) throw bridgeError('O navegador bloqueou a abertura do bridge local da TV. Permita a janela e tente novamente.');

  const pending = new Map<string, PendingRequest>();
  const externalSignal = options.signal;
  let disposed = false;
  let ready = false;
  let readyResolve: (() => void) | null = null;
  let readyReject: ((error: Error) => void) | null = null;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const closeWindow = () => {
    try {
      if (!bridgeWindow.closed) bridgeWindow.close();
    } catch {
      // best-effort: iOS pode impedir window.close()
    }
  };

  const rejectPending = (error: Error) => {
    for (const entry of pending.values()) {
      windowImpl.clearTimeout(entry.timeout);
      entry.reject(error);
    }
    pending.clear();
  };

  const dispose = (error?: Error) => {
    if (disposed) return;
    disposed = true;
    windowImpl.removeEventListener('message', onMessage as EventListener);
    externalSignal?.removeEventListener('abort', onAbort);
    if (!ready) readyReject?.(error ?? bridgeError('Bridge local encerrado antes de ficar pronto.'));
    rejectPending(error ?? bridgeError('Bridge local encerrado.'));
    closeWindow();
  };

  const onAbort = () => dispose(bridgeError('Conexão LAN cancelada.'));

  const onMessage = (event: MessageEvent) => {
    if (!isExpectedTvLanBridgeEvent(event, bridgeOrigin, bridgeWindow)) return;
    const message = parseTvLanBridgeMessage(event.data);
    if (!message || message.channelId !== channelId) return;

    if (message.type === 'ready') {
      if (!ready) {
        ready = true;
        readyResolve?.();
      }
      return;
    }

    if (message.type !== 'response') return;
    const entry = pending.get(message.requestId);
    if (!entry || !isMatchingTvLanBridgeResponse(message, {
      channelId,
      requestId: message.requestId,
      operation: entry.operation,
    })) return;

    pending.delete(message.requestId);
    windowImpl.clearTimeout(entry.timeout);
    const relay = relayPayload(message);
    if (message.ok) {
      if (!relay) {
        entry.reject(bridgeError('Bridge retornou uma resposta sem status HTTP válido.'));
        return;
      }
      entry.resolve(relay);
      return;
    }
    if (message.error === 'http_error' && relay) {
      entry.resolve(relay);
      return;
    }
    entry.reject(bridgeResponseError(message));
  };

  windowImpl.addEventListener('message', onMessage as EventListener);
  externalSignal?.addEventListener('abort', onAbort, { once: true });
  if (externalSignal?.aborted) {
    dispose(bridgeError('Conexão LAN cancelada.'));
    throw bridgeError('Conexão LAN cancelada.');
  }

  const readyTimeout = windowImpl.setTimeout(() => {
    if (!ready) dispose(bridgeError('A página bridge abriu, mas não confirmou o canal dentro do tempo esperado.'));
  }, requestTimeoutMs);
  try {
    await readyPromise;
  } finally {
    windowImpl.clearTimeout(readyTimeout);
  }

  const request = async (operation: TvLanBridgeOperation, payload: unknown) => {
    if (disposed) throw bridgeError('Bridge local já foi encerrado.');
    const message = createTvLanBridgeRequest(channelId, operation, payload, { timeoutMs: requestTimeoutMs });
    return new Promise<TvLanTransportResponse>((resolve, reject) => {
      const timeout = windowImpl.setTimeout(() => {
        pending.delete(message.requestId);
        reject(bridgeError('O bridge local não respondeu dentro do tempo esperado.'));
      }, requestTimeoutMs);
      pending.set(message.requestId, { operation, resolve, reject, timeout });
      try {
        bridgeWindow.postMessage(message, bridgeOrigin);
      } catch {
        pending.delete(message.requestId);
        windowImpl.clearTimeout(timeout);
        reject(bridgeError('Não foi possível enviar a request para o bridge local.'));
      }
    });
  };

  const finish = () => {
    if (disposed) return;
    void request('complete', null)
      .catch(() => undefined)
      .finally(() => dispose());
  };

  return {
    challenge: input => request('challenge', input),
    join: input => request('join', input),
    signalSend: input => request('signal-send', input),
    signalPoll: input => request('signal-poll', input),
    close: input => request('close', input),
    finish,
    dispose: () => dispose(),
  };
}
