(() => {
  const status = document.getElementById('status');
  const opener = window.opener;
  const params = new URLSearchParams(window.location.search);
  const PROTOCOL_VERSION = 1;
  const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
  const MAX_RELAY_TIMEOUT_MS = 10_000;
  const ALLOWED_OPERATIONS = new Set([
    'probe',
    'challenge',
    'join',
    'signal-send',
    'signal-poll',
    'close',
  ]);
  const ID_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
  const TOKEN_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
  const AUTHORIZATION_PATTERN = /^HomeMusic [A-Za-z0-9._:-]+\.[0-9]+\.[A-Za-z0-9._:-]+\.[A-Za-z0-9_-]+$/;
  const parentOrigin = normalizeOrigin(params.get('origin'));
  const channelId = params.get('channelId');

  function setStatus(message) {
    if (status) status.textContent = message;
  }

  function normalizeOrigin(value) {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.origin !== value) return null;
      return parsed.origin;
    } catch {
      return null;
    }
  }

  function serializedByteLength(value) {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function textByteLength(value) {
    try {
      return new TextEncoder().encode(value).byteLength;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function isJsonValue(value, seen = new Set(), depth = 0) {
    if (depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    seen.add(value);

    if (Array.isArray(value)) {
      const valid = value.every(item => isJsonValue(item, seen, depth + 1));
      seen.delete(value);
      return valid;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      seen.delete(value);
      return false;
    }
    const valid = Object.values(value).every(item => isJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return valid;
  }

  function hasExactKeys(value, expected) {
    const keys = Object.keys(value).sort();
    const sortedExpected = [...expected].sort();
    return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function isSafeToken(value) {
    return typeof value === 'string' && TOKEN_PATTERN.test(value);
  }

  function parseRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (serializedByteLength(value) > MAX_MESSAGE_BYTES) return null;
    if (!hasExactKeys(value, ['channelId', 'expiresAt', 'operation', 'payload', 'requestId', 'type', 'version'])) return null;
    if (value.version !== PROTOCOL_VERSION || value.type !== 'request') return null;
    if (value.channelId !== channelId || !ID_PATTERN.test(value.channelId)) return null;
    if (typeof value.requestId !== 'string' || !ID_PATTERN.test(value.requestId)) return null;
    if (typeof value.operation !== 'string' || !ALLOWED_OPERATIONS.has(value.operation)) return null;
    if (typeof value.expiresAt !== 'number' || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
    if (!isJsonValue(value.payload)) return null;
    return value;
  }

  function postResponse(request, ok, payload, error) {
    const response = {
      version: PROTOCOL_VERSION,
      type: 'response',
      channelId,
      requestId: request.requestId,
      operation: request.operation,
      expiresAt: request.expiresAt,
      ok,
      payload,
      error,
    };
    if (serializedByteLength(response) > MAX_MESSAGE_BYTES) {
      opener.postMessage({
        version: PROTOCOL_VERSION,
        type: 'response',
        channelId,
        requestId: request.requestId,
        operation: request.operation,
        expiresAt: request.expiresAt,
        ok: false,
        payload: null,
        error: 'response_too_large',
      }, parentOrigin);
      return;
    }
    opener.postMessage(response, parentOrigin);
  }

  function invalidPayload(request) {
    postResponse(request, false, null, 'invalid_payload');
  }

  function relayTimeout(request) {
    return Math.max(1, Math.min(MAX_RELAY_TIMEOUT_MS, request.expiresAt - Date.now()));
  }

  async function relayJson(request, target, init = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), relayTimeout(request));
    try {
      const response = await fetch(target, {
        ...init,
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      const text = await response.text();
      if (textByteLength(text) > MAX_MESSAGE_BYTES) {
        return { ok: false, payload: null, error: 'response_too_large' };
      }

      let body = null;
      if (text !== '') {
        try {
          body = JSON.parse(text);
        } catch {
          return { ok: false, payload: { status: response.status }, error: 'invalid_response' };
        }
      }

      const payload = { status: response.status, body };
      if (!response.ok) return { ok: false, payload, error: 'http_error' };
      return { ok: true, payload, error: null };
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, payload: null, error: 'timeout' };
      return { ok: false, payload: null, error: 'network_error' };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function executeRequest(request) {
    const payload = request.payload;

    if (request.operation === 'probe') {
      if (payload !== null) return { ok: false, payload: null, error: 'invalid_payload' };
      return { ok: true, payload: { pong: true }, error: null };
    }

    if (request.operation === 'challenge') {
      if (!isPlainObject(payload) || !hasExactKeys(payload, ['clientNonce', 'sessionId'])) return null;
      if (!isSafeToken(payload.sessionId) || !isSafeToken(payload.clientNonce)) return null;
      const target = `/challenge?session=${encodeURIComponent(payload.sessionId)}&clientNonce=${encodeURIComponent(payload.clientNonce)}`;
      return relayJson(request, target);
    }

    if (request.operation === 'join') {
      if (!isPlainObject(payload) || !hasExactKeys(payload, ['clientNonce', 'expiresAt', 'proof', 'sessionId', 'tvNonce'])) return null;
      if (!isSafeToken(payload.sessionId) || !isSafeToken(payload.clientNonce) || !isSafeToken(payload.tvNonce)) return null;
      if (typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt)) return null;
      if (typeof payload.proof !== 'string' || payload.proof.length < 16 || payload.proof.length > 512) return null;
      return relayJson(request, '/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: payload.sessionId,
          clientNonce: payload.clientNonce,
          tvNonce: payload.tvNonce,
          expiresAt: payload.expiresAt,
          proof: payload.proof,
        }),
      });
    }

    if (request.operation === 'signal-send') {
      if (!isPlainObject(payload) || !hasExactKeys(payload, ['authorization', 'body'])) return null;
      if (typeof payload.authorization !== 'string' || !AUTHORIZATION_PATTERN.test(payload.authorization)) return null;
      if (typeof payload.body !== 'string' || textByteLength(payload.body) > MAX_MESSAGE_BYTES) return null;
      try {
        const body = JSON.parse(payload.body);
        if (!isJsonValue(body)) return null;
      } catch {
        return null;
      }
      return relayJson(request, '/signals?role=remote', {
        method: 'POST',
        headers: {
          Authorization: payload.authorization,
          'Content-Type': 'application/json',
        },
        body: payload.body,
      });
    }

    if (request.operation === 'signal-poll') {
      if (!isPlainObject(payload) || !hasExactKeys(payload, ['authorization', 'cursor'])) return null;
      if (typeof payload.authorization !== 'string' || !AUTHORIZATION_PATTERN.test(payload.authorization)) return null;
      if (typeof payload.cursor !== 'number' || !Number.isSafeInteger(payload.cursor) || payload.cursor < 0) return null;
      const target = `/signals?role=remote&cursor=${encodeURIComponent(String(payload.cursor))}`;
      return relayJson(request, target, {
        headers: { Authorization: payload.authorization },
      });
    }

    if (request.operation === 'close') {
      if (!isPlainObject(payload) || !hasExactKeys(payload, ['authorization'])) return null;
      if (typeof payload.authorization !== 'string' || !AUTHORIZATION_PATTERN.test(payload.authorization)) return null;
      return relayJson(request, '/close?role=remote', {
        method: 'POST',
        headers: { Authorization: payload.authorization },
      });
    }

    return { ok: false, payload: null, error: 'unsupported_operation' };
  }

  if (!opener) {
    setStatus('Sem janela de origem. Abra este bridge pelo Home Music.');
    return;
  }
  if (!parentOrigin || typeof channelId !== 'string' || !ID_PATTERN.test(channelId)) {
    setStatus('Canal do bridge inválido. Volte ao Home Music e tente novamente.');
    return;
  }

  let busy = false;
  window.addEventListener('message', async event => {
    if (event.source !== opener || event.origin !== parentOrigin) return;
    const request = parseRequest(event.data);
    if (!request) return;
    if (busy) {
      postResponse(request, false, null, 'busy');
      return;
    }

    busy = true;
    try {
      const result = await executeRequest(request);
      if (!result) {
        invalidPayload(request);
        return;
      }
      if (request.expiresAt <= Date.now()) return;
      postResponse(request, result.ok, result.payload, result.error);
      if (request.operation === 'probe' && result.ok) {
        setStatus('Canal v1 validado. Aguardando pareamento…');
      } else if (request.operation === 'close' && result.ok) {
        setStatus('Sessão encerrada. Você pode voltar ao Home Music.');
        window.setTimeout(() => window.close(), 100);
      } else {
        setStatus(result.ok ? 'Comando LAN concluído. Aguardando próximo passo…' : 'Não foi possível concluir o comando LAN. Volte ao Home Music.');
      }
    } finally {
      busy = false;
    }
  });

  opener.postMessage({
    version: PROTOCOL_VERSION,
    type: 'ready',
    channelId,
  }, parentOrigin);
  setStatus('Bridge v1 aberto. Aguardando pareamento do Home Music…');
})();
