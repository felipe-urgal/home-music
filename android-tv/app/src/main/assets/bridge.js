(() => {
  const status = document.getElementById('status');
  const opener = window.opener;
  const params = new URLSearchParams(window.location.search);
  const PROTOCOL_VERSION = 1;
  const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
  const ALLOWED_OPERATIONS = new Set([
    'probe',
    'challenge',
    'join',
    'signal-send',
    'signal-poll',
    'close',
  ]);
  const ID_PATTERN = /^[A-Za-z0-9._:-]{16,128}$/;
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
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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
    if (serializedByteLength(response) > MAX_MESSAGE_BYTES) return;
    opener.postMessage(response, parentOrigin);
  }

  if (!opener) {
    setStatus('Sem janela de origem. Abra este bridge pelo Home Music.');
    return;
  }
  if (!parentOrigin || typeof channelId !== 'string' || !ID_PATTERN.test(channelId)) {
    setStatus('Canal do bridge inválido. Volte ao Home Music e tente novamente.');
    return;
  }

  window.addEventListener('message', event => {
    if (event.source !== opener || event.origin !== parentOrigin) return;
    const request = parseRequest(event.data);
    if (!request) return;

    if (request.operation === 'probe') {
      if (request.payload !== null) {
        postResponse(request, false, null, 'invalid_payload');
        return;
      }
      postResponse(request, true, { pong: true }, null);
      setStatus('Canal v1 validado. Volte ao Home Music.');
      return;
    }

    postResponse(request, false, null, 'not_implemented');
  });

  opener.postMessage({
    version: PROTOCOL_VERSION,
    type: 'ready',
    channelId,
  }, parentOrigin);
  setStatus('Bridge v1 aberto. Aguardando comando do Home Music…');
})();
