import type { FastifyRequest } from 'fastify';
import type { OpenSubsonicAuthenticatedKey, OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { failure, has, one, type Query } from './open-subsonic-http.js';

export const VALID_KEY_REQUESTS_PER_MINUTE = 600;
export const INVALID_AUTH_ATTEMPTS_PER_MINUTE = 30;
export const MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS = 4_096;

export type OpenSubsonicCredentials = Pick<OpenSubsonicCredentialStore, 'authenticate'>;

export type RateEntry = { windowStartedAt: number; count: number };

export class OpenSubsonicRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  hit(subject: string, limit: number, now = Date.now()) {
    const current = this.entries.get(subject);
    if (current) {
      if (now - current.windowStartedAt >= 60_000) {
        this.entries.set(subject, { windowStartedAt: now, count: 1 });
        return true;
      }
      current.count += 1;
      return current.count <= limit;
    }

    if (this.entries.size >= MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS) {
      this.cleanup(now);
      if (this.entries.size >= MAX_OPEN_SUBSONIC_RATE_LIMIT_SUBJECTS) return false;
    }

    this.entries.set(subject, { windowStartedAt: now, count: 1 });
    return true;
  }

  private cleanup(now: number) {
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartedAt >= 120_000) this.entries.delete(key);
    }
  }
}

export function authenticationFailure(query: Query) {
  const apiKeyPresent = has(query, 'apiKey');
  const passwordAuthPresent = has(query, 'u') || has(query, 'p');
  const tokenAuthPresent = has(query, 't') || has(query, 's');
  if (apiKeyPresent && (passwordAuthPresent || tokenAuthPresent)) {
    return failure(43, 'Múltiplos mecanismos de autenticação foram enviados.');
  }
  if (tokenAuthPresent) {
    return failure(41, 'Autenticação token/salt legada não é suportada. Use uma API key do Home Music.');
  }
  if (passwordAuthPresent && (!one(query, 'u') || !one(query, 'p'))) {
    return failure(42, 'Autenticação legada incompleta. Use usuário + API key do Home Music.');
  }
  return null;
}

export function decodeLegacyApiKey(value: string) {
  if (!value.startsWith('enc:')) return value;
  const encoded = value.slice(4);
  if (!encoded || encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) return null;
  try {
    return Buffer.from(encoded, 'hex').toString('utf8');
  } catch {
    return null;
  }
}

export function authenticatedRequest(
  request: FastifyRequest,
  query: Query,
  credentials: OpenSubsonicCredentials,
  limiter: OpenSubsonicRateLimiter
): { identity: OpenSubsonicAuthenticatedKey } | { response: ReturnType<typeof failure>; statusCode?: number } {
  const mechanismError = authenticationFailure(query);
  if (mechanismError) return { response: mechanismError };

  const apiKey = one(query, 'apiKey');
  const legacyUsername = apiKey ? null : one(query, 'u');
  const legacyPassword = apiKey ? null : one(query, 'p');
  const legacyApiKey = legacyPassword ? decodeLegacyApiKey(legacyPassword) : null;
  const rawKey = apiKey ?? legacyApiKey;

  if (!rawKey) {
    const subject = `invalid:${request.ip}`;
    if (!limiter.hit(subject, INVALID_AUTH_ATTEMPTS_PER_MINUTE)) {
      return { response: failure(0, 'Muitas tentativas de autenticação. Tente novamente em instantes.'), statusCode: 429 };
    }
    return { response: failure(apiKey ? 44 : 40, apiKey ? 'API key inválida ou ausente.' : 'Usuário ou chave de aplicativo inválidos.') };
  }

  const identity = credentials.authenticate(rawKey);
  if (!identity || (legacyUsername != null && legacyUsername !== identity.user.username)) {
    const subject = `invalid:${request.ip}`;
    if (!limiter.hit(subject, INVALID_AUTH_ATTEMPTS_PER_MINUTE)) {
      return { response: failure(0, 'Muitas tentativas de autenticação. Tente novamente em instantes.'), statusCode: 429 };
    }
    return {
      response: failure(apiKey ? 44 : 40, apiKey ? 'API key inválida ou revogada.' : 'Usuário ou chave de aplicativo inválidos.')
    };
  }

  if (!limiter.hit(`key:${identity.keyId}`, VALID_KEY_REQUESTS_PER_MINUTE)) {
    return { response: failure(0, 'Limite temporário de requisições atingido.'), statusCode: 429 };
  }
  return { identity };
}
