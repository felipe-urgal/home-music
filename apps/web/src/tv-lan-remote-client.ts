import {
  TV_LAN_REMOTE_VERSION,
  isTvLanEphemeralToken,
  isTvLanSignalEnvelope,
  parseTvLanQrText,
  tvLanProofMessage,
  tvLanRequestKeyMessage,
  type TvLanChallenge,
  type TvLanJoinResponse,
  type TvLanQrPayload,
  type TvLanSignalEnvelope
} from '@home-music/shared/tv-lan-remote';
import type { TvRemoteSignal } from '@home-music/shared/tv-remote';
import { createTvLanBridgeTransport } from './tv-lan-bridge-client';
import type { TvLanTransport, TvLanTransportFactory, TvLanTransportResponse } from './tv-lan-transport';
import { selectTvLanTransport } from './tv-lan-transport-selection';

type FetchLike = typeof fetch;

type TvLanRemoteOptions = {
  fetchImpl?: FetchLike;
  transportFactory?: TvLanTransportFactory;
  pollDelayMs?: number;
  requestTimeoutMs?: number;
  createClientNonce?: () => string;
  createMessageId?: () => string;
  createRequestNonce?: () => string;
  now?: () => number;
  cryptoImpl?: Crypto;
  signal?: AbortSignal;
  localNetworkPermissionState?: () => Promise<PermissionState | null>;
};

export type TvLanRemoteSignaling = {
  pairing: TvLanQrPayload;
  session: TvLanJoinResponse;
  sendSignal: (signal: TvRemoteSignal) => Promise<void>;
  start: (onSignal: (signal: TvRemoteSignal) => void | Promise<void>, onError?: (error: Error) => void) => void;
  close: () => void;
};

type TvLanRequestAuthorizationInput = {
  secret: string;
  challenge: TvLanChallenge;
  session: TvLanJoinResponse;
  method: string;
  target: string;
  body?: string;
  timestamp: number;
  nonce: string;
  cryptoImpl?: Crypto;
};

function remoteError(message: string) {
  return new Error(message);
}

function randomToken(cryptoImpl: Crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function decodeHex(value: string) {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    throw remoteError('Segredo de pareamento LAN inválido.');
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function importHmacKey(raw: Uint8Array, cryptoImpl: Crypto) {
  return cryptoImpl.subtle.importKey(
    'raw',
    toArrayBuffer(raw),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

export async function computeTvLanJoinProof(
  secret: string,
  challenge: TvLanChallenge,
  cryptoImpl: Crypto = crypto
) {
  if (!cryptoImpl.subtle) throw remoteError('Este navegador não oferece criptografia para o pareamento LAN.');
  const key = await importHmacKey(decodeHex(secret), cryptoImpl);
  const signature = await cryptoImpl.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(tvLanProofMessage(challenge))
  );
  return base64Url(new Uint8Array(signature));
}

export async function computeTvLanRequestAuthorization(input: TvLanRequestAuthorizationInput) {
  const cryptoImpl = input.cryptoImpl ?? crypto;
  if (!cryptoImpl.subtle) throw remoteError('Este navegador não oferece criptografia para a sessão LAN.');
  const method = input.method.toUpperCase();
  if (!/^[A-Z]+$/.test(method) || !input.target.startsWith('/') || input.target.includes('\n')) {
    throw remoteError('Requisição LAN inválida para autenticação.');
  }
  if (!Number.isSafeInteger(input.timestamp) || !isTvLanEphemeralToken(input.nonce, 128)) {
    throw remoteError('Nonce ou timestamp de autenticação LAN inválido.');
  }

  const pairingKey = await importHmacKey(decodeHex(input.secret), cryptoImpl);
  const requestKeyBytes = new Uint8Array(await cryptoImpl.subtle.sign(
    'HMAC',
    pairingKey,
    new TextEncoder().encode(tvLanRequestKeyMessage(input.challenge, input.session))
  ));
  const bodyBytes = new TextEncoder().encode(input.body ?? '');
  const bodyHash = base64Url(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bodyBytes)));
  const canonical = `${TV_LAN_REMOTE_VERSION}\nrequest\n${input.challenge.sessionId}\n${input.session.sessionToken}\n${method}\n${input.target}\n${bodyHash}\n${input.timestamp}\n${input.nonce}`;
  const requestKey = await importHmacKey(requestKeyBytes, cryptoImpl);
  const signature = new Uint8Array(await cryptoImpl.subtle.sign(
    'HMAC',
    requestKey,
    new TextEncoder().encode(canonical)
  ));
  return `HomeMusic ${input.session.sessionToken}.${input.timestamp}.${input.nonce}.${base64Url(signature)}`;
}

function parseChallenge(value: unknown, pairing: TvLanQrPayload, clientNonce: string, now: number): TvLanChallenge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const challenge = value as Record<string, unknown>;
  const keys = Object.keys(challenge);
  if (keys.length !== 4 || !keys.every(key => ['sessionId', 'clientNonce', 'tvNonce', 'expiresAt'].includes(key))) return null;
  if (challenge.sessionId !== pairing.sessionId || challenge.clientNonce !== clientNonce) return null;
  if (!isTvLanEphemeralToken(challenge.tvNonce, 128)) return null;
  if (typeof challenge.expiresAt !== 'number' || !Number.isSafeInteger(challenge.expiresAt)) return null;
  if (challenge.expiresAt <= now || challenge.expiresAt > pairing.expiresAt) return null;
  return challenge as TvLanChallenge;
}

function parseJoin(value: unknown, now: number): TvLanJoinResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const joined = value as Record<string, unknown>;
  const keys = Object.keys(joined);
  if (keys.length !== 2 || !keys.every(key => ['sessionToken', 'expiresAt'].includes(key))) return null;
  if (!isTvLanEphemeralToken(joined.sessionToken)) return null;
  if (typeof joined.expiresAt !== 'number' || !Number.isSafeInteger(joined.expiresAt) || joined.expiresAt <= now) return null;
  return joined as TvLanJoinResponse;
}

function responseError(status: number, fallback: string) {
  if (status === 401) return remoteError('O código de pareamento da TV é inválido ou expirou.');
  if (status === 403) return remoteError('A TV recusou esta origem do Home Music.');
  if (status === 404 || status === 410) return remoteError('O pareamento da TV expirou. Gere um novo QR.');
  if (status === 429) return remoteError('A TV recebeu muitas tentativas. Aguarde e gere um novo pareamento.');
  return remoteError(fallback);
}

function responseOk(response: TvLanTransportResponse) {
  return response.status >= 200 && response.status < 300;
}

async function defaultLocalNetworkPermissionState(): Promise<PermissionState | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  for (const name of ['local-network', 'local-network-access']) {
    try {
      const status = await navigator.permissions.query({ name } as unknown as PermissionDescriptor);
      return status.state;
    } catch {
      // Older Chromium builds may know only the legacy alias.
    }
  }
  return null;
}

export function tvLanRequestErrorMessage(error: unknown, permissionState: PermissionState | null = null) {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (permissionState === 'denied' || name === 'NotAllowedError' || name === 'SecurityError') {
    return 'O acesso à rede local foi negado. Autorize o Home Music a acessar dispositivos da rede local e tente novamente.';
  }
  return 'Não foi possível alcançar a TV na rede local. Confirme que celular e TV estão na mesma rede e sem isolamento entre clientes.';
}

function createDirectTransportFactory(
  fetchImpl: FetchLike,
  permissionState: () => Promise<PermissionState | null>,
): TvLanTransportFactory {
  return async (pairing, options) => {
    const baseUrl = `http://${pairing.host}:${pairing.port}`;
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    options.signal.addEventListener('abort', abortFromParent, { once: true });
    if (options.signal.aborted) controller.abort();

    const lanFetch = async (target: string, init: RequestInit = {}): Promise<TvLanTransportResponse> => {
      if (controller.signal.aborted) throw remoteError('Conexão LAN cancelada.');
      const requestController = new AbortController();
      let timedOut = false;
      const abortRequest = () => requestController.abort();
      controller.signal.addEventListener('abort', abortRequest, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        requestController.abort();
      }, options.requestTimeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}${target}`, { ...init, cache: 'no-store', signal: requestController.signal });
        let body: unknown = null;
        try {
          body = await response.json() as unknown;
        } catch {
          throw remoteError('A TV retornou uma resposta LAN inválida.');
        }
        return { status: response.status, body };
      } catch (error) {
        if (controller.signal.aborted) throw remoteError('Conexão LAN cancelada.');
        if (timedOut) throw remoteError('A TV não respondeu a tempo na rede local.');
        if (error instanceof Error && error.message === 'A TV retornou uma resposta LAN inválida.') throw error;
        throw remoteError(tvLanRequestErrorMessage(error, await permissionState()));
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abortRequest);
      }
    };

    return {
      challenge: input => lanFetch(`/challenge?session=${encodeURIComponent(input.sessionId)}&clientNonce=${encodeURIComponent(input.clientNonce)}`),
      join: input => lanFetch('/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
      signalSend: input => lanFetch('/signals?role=remote', {
        method: 'POST',
        headers: {
          Authorization: input.authorization,
          'Content-Type': 'application/json',
        },
        body: input.body,
      }),
      signalPoll: input => lanFetch(`/signals?role=remote&cursor=${encodeURIComponent(String(input.cursor))}`, {
        headers: { Authorization: input.authorization },
      }),
      close: input => lanFetch('/close?role=remote', {
        method: 'POST',
        headers: { Authorization: input.authorization },
      }),
      dispose: () => {
        options.signal.removeEventListener('abort', abortFromParent);
        controller.abort();
      },
    } satisfies TvLanTransport;
  };
}

export async function createTvLanRemoteSignaling(
  qrText: string,
  options: TvLanRemoteOptions = {}
): Promise<TvLanRemoteSignaling> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cryptoImpl = options.cryptoImpl ?? crypto;
  const pairing = parseTvLanQrText(qrText.trim(), now());
  if (!pairing) throw remoteError('QR de pareamento inválido ou expirado.');

  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) throw remoteError('Conexão LAN cancelada.');
  externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
  const cleanupExternalAbort = () => externalSignal?.removeEventListener('abort', abortFromExternal);
  const permissionState = options.localNetworkPermissionState ?? defaultLocalNetworkPermissionState;
  const requestTimeoutMs = Math.max(1_000, options.requestTimeoutMs ?? 10_000);
  const transportFactory = options.transportFactory ?? (
    selectTvLanTransport() === 'bridge'
      ? ((bridgePairing, transportOptions) => createTvLanBridgeTransport(bridgePairing, transportOptions))
      : createDirectTransportFactory(fetchImpl, permissionState)
  );
  let transport: TvLanTransport | null = null;

  try {
    const createClientNonce = options.createClientNonce ?? (() => randomToken(cryptoImpl));
    const createMessageId = options.createMessageId ?? (() => randomToken(cryptoImpl));
    const createRequestNonce = options.createRequestNonce ?? (() => randomToken(cryptoImpl));
    const clientNonce = createClientNonce();
    if (!isTvLanEphemeralToken(clientNonce, 128)) throw remoteError('Nonce de pareamento LAN inválido.');

    transport = await transportFactory(pairing, { signal: controller.signal, requestTimeoutMs });
    const challengeResponse = await transport.challenge({ sessionId: pairing.sessionId, clientNonce });
    if (!responseOk(challengeResponse)) throw responseError(challengeResponse.status, 'Não foi possível iniciar o pareamento com a TV.');
    const challenge = parseChallenge(challengeResponse.body, pairing, clientNonce, now());
    if (!challenge) throw remoteError('A TV retornou um challenge de pareamento inválido.');

    const proof = await computeTvLanJoinProof(pairing.secret, challenge, cryptoImpl);
    const joinResponse = await transport.join({ ...challenge, proof });
    if (!responseOk(joinResponse)) throw responseError(joinResponse.status, 'Não foi possível concluir o pareamento com a TV.');
    const session = parseJoin(joinResponse.body, now());
    if (!session) throw remoteError('A TV retornou uma sessão LAN inválida.');

    const signedAuthorization = (method: string, target: string, body = '') => computeTvLanRequestAuthorization({
      secret: pairing.secret,
      challenge,
      session,
      method,
      target,
      body,
      timestamp: now(),
      nonce: createRequestNonce(),
      cryptoImpl
    });
    const bestEffortClose = async () => {
      const target = '/close?role=remote';
      try {
        const authorization = await signedAuthorization('POST', target);
        await transport?.close({ authorization });
      } catch {
        // Closing is best effort; session TTL is the final cleanup boundary.
      }
    };

    if (controller.signal.aborted) {
      void bestEffortClose();
      transport.dispose();
      throw remoteError('Conexão LAN cancelada.');
    }

    const pollDelayMs = Math.max(100, options.pollDelayMs ?? 300);
    let cursor = 0;
    let started = false;
    let closed = false;

    const ensureActive = () => {
      if (closed || controller.signal.aborted) throw remoteError('A conexão LAN com a TV foi encerrada.');
      if (now() >= session.expiresAt) {
        closed = true;
        controller.abort();
        throw remoteError('A sessão de pareamento com a TV expirou.');
      }
    };

    const sendSignal = async (signal: TvRemoteSignal) => {
      ensureActive();
      const envelope: TvLanSignalEnvelope = {
        messageId: createMessageId(),
        from: 'remote',
        signal: { ...signal, from: 'remote' }
      };
      if (!isTvLanSignalEnvelope(envelope)) throw remoteError('Sinalização WebRTC inválida.');
      const target = '/signals?role=remote';
      const body = JSON.stringify(envelope);
      const authorization = await signedAuthorization('POST', target, body);

      const response = await transport!.signalSend({ authorization, body });
      if (!responseOk(response)) throw responseError(response.status, 'Falha ao enviar sinalização local para a TV.');
    };

    const start = (
      onSignal: (signal: TvRemoteSignal) => void | Promise<void>,
      onError?: (error: Error) => void
    ) => {
      if (started || closed) return;
      started = true;
      const run = async () => {
        while (!closed && !controller.signal.aborted) {
          try {
            ensureActive();
            const target = `/signals?role=remote&cursor=${encodeURIComponent(String(cursor))}`;
            const authorization = await signedAuthorization('GET', target);
            const response = await transport!.signalPoll({ authorization, cursor });
            if (!responseOk(response)) {
              const error = responseError(response.status, 'Falha ao receber sinalização local da TV.');
              if (response.status === 401 || response.status === 410) {
                closed = true;
                controller.abort();
              }
              throw error;
            }
            const value = response.body;
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
              throw remoteError('Resposta de sinalização local inválida.');
            }
            const poll = value as { cursor?: unknown; messages?: unknown };
            if (typeof poll.cursor !== 'number' || !Number.isSafeInteger(poll.cursor) || poll.cursor < cursor || !Array.isArray(poll.messages)) {
              throw remoteError('Cursor de sinalização local inválido.');
            }
            cursor = poll.cursor;
            for (const message of poll.messages) {
              if (!isTvLanSignalEnvelope(message) || message.from !== 'tv') continue;
              await onSignal(message.signal);
            }
          } catch (error) {
            if (closed || controller.signal.aborted) {
              if (error instanceof Error && error.message.includes('expirou')) onError?.(error);
              return;
            }
            onError?.(error instanceof Error ? error : remoteError('Falha na sinalização local da TV.'));
          }
          if (closed || controller.signal.aborted) return;
          await new Promise(resolve => setTimeout(resolve, pollDelayMs));
        }
      };
      void run();
    };

    return {
      pairing,
      session,
      sendSignal,
      start,
      close: () => {
        if (closed) return;
        closed = true;
        cleanupExternalAbort();
        void bestEffortClose().finally(() => {
          controller.abort();
          transport?.dispose();
        });
      }
    };
  } catch (error) {
    controller.abort();
    transport?.dispose();
    cleanupExternalAbort();
    throw error;
  }
}
