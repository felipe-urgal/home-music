import type { FastifyInstance, FastifyRequest } from 'fastify';

export const OPEN_SUBSONIC_PROTOCOL_VERSION = '1.16.1';
const OPEN_SUBSONIC_SERVER_TYPE = 'Home Music';
const OPEN_SUBSONIC_SERVER_VERSION = '0.1.0';
const MAX_CLIENT_ID_LENGTH = 120;

type QueryValue = string | string[] | undefined;
export type OpenSubsonicProtocolQuery = Record<string, QueryValue>;

type ParsedVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
}>;

export type OpenSubsonicProtocolValidation =
  | Readonly<{ ok: true; version: string; client: string }>
  | Readonly<{ ok: false; code: 0 | 10 | 20 | 30; message: string }>;

function one(query: OpenSubsonicProtocolQuery, key: string) {
  const value = query[key];
  return typeof value === 'string' ? value : null;
}

function cleanClientId(value: string | null) {
  if (value == null) return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length > MAX_CLIENT_ID_LENGTH) return null;
  return clean;
}

function parseVersion(value: string | null): ParsedVersion | null {
  if (!value) return null;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  return { major, minor, patch };
}

function compareVersion(left: ParsedVersion, right: ParsedVersion) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

const SUPPORTED_VERSION = parseVersion(OPEN_SUBSONIC_PROTOCOL_VERSION)!;

export function validateOpenSubsonicCommonParameters(
  query: OpenSubsonicProtocolQuery
): OpenSubsonicProtocolValidation {
  const rawVersion = one(query, 'v');
  const rawClient = one(query, 'c');
  if (!rawVersion || !rawClient) {
    return {
      ok: false,
      code: 10,
      message: 'Parâmetros obrigatórios ausentes. Informe v e c.'
    };
  }

  const client = cleanClientId(rawClient);
  if (!client) {
    return {
      ok: false,
      code: 0,
      message: 'Identificador de cliente OpenSubsonic inválido.'
    };
  }

  const requested = parseVersion(rawVersion);
  if (!requested) {
    return {
      ok: false,
      code: 20,
      message: 'Versão do protocolo OpenSubsonic inválida. Atualize o cliente.'
    };
  }

  if (requested.major < SUPPORTED_VERSION.major) {
    return {
      ok: false,
      code: 20,
      message: 'Versão do protocolo incompatível. O cliente precisa ser atualizado.'
    };
  }

  if (requested.major > SUPPORTED_VERSION.major || compareVersion(requested, SUPPORTED_VERSION) > 0) {
    return {
      ok: false,
      code: 30,
      message: 'Versão do protocolo incompatível. O servidor precisa ser atualizado.'
    };
  }

  return { ok: true, version: rawVersion, client };
}

export function openSubsonicProtocolFailure(
  code: OpenSubsonicProtocolValidation extends { ok: false; code: infer C } ? C : never,
  message: string
) {
  return {
    'subsonic-response': {
      status: 'failed',
      version: OPEN_SUBSONIC_PROTOCOL_VERSION,
      type: OPEN_SUBSONIC_SERVER_TYPE,
      serverVersion: OPEN_SUBSONIC_SERVER_VERSION,
      openSubsonic: true,
      error: { code, message }
    }
  };
}

function normalizedEndpoint(request: FastifyRequest) {
  const params = request.params as { endpoint?: unknown };
  if (typeof params?.endpoint !== 'string') return null;
  return params.endpoint.endsWith('.view') ? params.endpoint.slice(0, -5) : params.endpoint;
}

export function registerOpenSubsonicProtocolGuard(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.url !== '/rest/:endpoint') return;
    if (normalizedEndpoint(request) === 'getOpenSubsonicExtensions') return;

    const validation = validateOpenSubsonicCommonParameters(
      (request.query ?? {}) as OpenSubsonicProtocolQuery
    );
    if (validation.ok) return;

    return reply
      .header('Cache-Control', 'private, no-store')
      .code(200)
      .send(openSubsonicProtocolFailure(validation.code, validation.message));
  });
}
