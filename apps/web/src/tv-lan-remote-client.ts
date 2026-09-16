import {
  isTvLanEphemeralToken,
  isTvLanSignalEnvelope,
  parseTvLanQrText,
  tvLanProofMessage,
  type TvLanChallenge,
  type TvLanJoinResponse,
  type TvLanQrPayload,
  type TvLanSignalEnvelope
} from '@home-music/shared/tv-lan-remote';
import type { TvRemoteSignal } from '@home-music/shared/tv-remote';

type FetchLike = typeof fetch;

type TvLanRemoteOptions = {
  fetchImpl?: FetchLike;
  pollDelayMs?: number;
  requestTimeoutMs?: number;
  createClientNonce?: () => string;
  createMessageId?: () => string;
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

export async function computeTvLanJoinProof(
  secret: string,
  challenge: TvLanChallenge,
  cryptoImpl: Crypto = crypto
) {
  if (!cryptoImpl.subtle) throw remoteError('Este navegador não oferece criptografia para o pareamento LAN.');
  const key = await cryptoImpl.subtle.importKey(
    'raw',
    decodeHex(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await cryptoImpl.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(tvLanProofMessage(challenge))
  );
  return base64Url(new Uint8Array(signature));
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

async function readJson(response: Response) {
  try {
    return await response.json() as unknown;
  } catch {
    throw remoteError('A TV retornou uma resposta LAN inválida.');
  }
}

function responseError(response: Response, fallback: string) {
  if (response.status === 401) return remoteError('O código de pareamento da TV é inválido ou expirou.');
  if (response.status === 403) return remoteError('A TV recusou esta origem do Home Music.');
  if (response.status === 404 || response.status === 410) return remoteError('O pareamento da TV expirou. Gere um novo QR.');
  if (response.status === 429) return remoteError('A TV recebeu muitas tentativas. Aguarde e gere um novo pareamento.');
  return remoteError(fallback);
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

  const lanFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (controller.signal.aborted) throw remoteError('Conexão LAN cancelada.');
    const requestController = new AbortController();
    let timedOut = false;
    const abortRequest = () => requestController.abort();
    controller.signal.addEventListener('abort', abortRequest, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      requestController.abort();
    }, requestTimeoutMs);
    try {
      return await fetchImpl(input, { ...init, signal: requestController.signal });
    } catch (error) {
      if (controller.signal.aborted) throw remoteError('Conexão LAN cancelada.');
      if (timedOut) throw remoteError('A TV não respondeu a tempo na rede local.');
      throw remoteError(tvLanRequestErrorMessage(error, await permissionState()));
    } finally {
      window.clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortRequest);
    }
  };

  try {
    const createClientNonce = options.createClientNonce ?? (() => randomToken(cryptoImpl));
    const createMessageId = options.createMessageId ?? (() => randomToken(cryptoImpl));
    const clientNonce = createClientNonce();
    if (!isTvLanEphemeralToken(clientNonce, 128)) throw remoteError('Nonce de pareamento LAN inválido.');

    const baseUrl = `http://${pairing.host}:${pairing.port}`;
    const challengeResponse = await lanFetch(
      `${baseUrl}/challenge?session=${encodeURIComponent(pairing.sessionId)}&clientNonce=${encodeURIComponent(clientNonce)}`,
      { cache: 'no-store' }
    );
    if (!challengeResponse.ok) throw responseError(challengeResponse, 'Não foi possível iniciar o pareamento com a TV.');
    const challenge = parseChallenge(await readJson(challengeResponse), pairing, clientNonce, now());
    if (!challenge) throw remoteError('A TV retornou um challenge de pareamento inválido.');

    const proof = await computeTvLanJoinProof(pairing.secret, challenge, cryptoImpl);
    const joinResponse = await lanFetch(`${baseUrl}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...challenge, proof }),
      cache: 'no-store'
    });
    if (!joinResponse.ok) throw responseError(joinResponse, 'Não foi possível concluir o pareamento com a TV.');
    const session = parseJoin(await readJson(joinResponse), now());
    if (!session) throw remoteError('A TV retornou uma sessão LAN inválida.');
    if (controller.signal.aborted) {
      void fetchImpl(`${baseUrl}/close?role=remote`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.sessionToken}` },
        cache: 'no-store'
      }).catch(() => undefined);
      throw remoteError('Conexão LAN cancelada.');
    }

    const pollDelayMs = Math.max(100, options.pollDelayMs ?? 300);
    let cursor = 0;
    let started = false;
    let closed = false;

    const authHeaders = () => ({ Authorization: `Bearer ${session.sessionToken}` });

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

      const response = await lanFetch(`${baseUrl}/signals?role=remote`, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(envelope),
        cache: 'no-store'
      });
      if (!response.ok) throw responseError(response, 'Falha ao enviar sinalização local para a TV.');
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
            const response = await lanFetch(
              `${baseUrl}/signals?role=remote&cursor=${encodeURIComponent(String(cursor))}`,
              { headers: authHeaders(), cache: 'no-store' }
            );
            if (!response.ok) {
              const error = responseError(response, 'Falha ao receber sinalização local da TV.');
              if (response.status === 401 || response.status === 410) {
                closed = true;
                controller.abort();
              }
              throw error;
            }
            const value = await readJson(response);
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
        controller.abort();
        cleanupExternalAbort();
        void fetchImpl(`${baseUrl}/close?role=remote`, {
          method: 'POST',
          headers: authHeaders(),
          cache: 'no-store'
        }).catch(() => undefined);
      }
    };
  } catch (error) {
    controller.abort();
    cleanupExternalAbort();
    throw error;
  }
}
