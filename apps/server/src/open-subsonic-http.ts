export const PROTOCOL_VERSION = '1.16.1';
export const SERVER_TYPE = 'Home Music';
export const SERVER_VERSION = '0.1.0';
export const DEFAULT_LIST_COUNT = 20;
export const MAX_LIST_COUNT = 500;
export type QueryValue = string | string[] | undefined;
export type Query = Record<string, QueryValue>;

export function responseBase() {
  return {
    version: PROTOCOL_VERSION,
    type: SERVER_TYPE,
    serverVersion: SERVER_VERSION,
    openSubsonic: true
  } as const;
}

export function success(payload: Record<string, unknown> = {}) {
  return {
    'subsonic-response': {
      status: 'ok',
      ...responseBase(),
      ...payload
    }
  };
}

export function failure(code: number, message: string) {
  return {
    'subsonic-response': {
      status: 'failed',
      ...responseBase(),
      error: { code, message }
    }
  };
}

export function one(query: Query, key: string) {
  const value = query[key];
  return typeof value === 'string' ? value : null;
}

export function many(query: Query, key: string) {
  const value = query[key];
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
}

export function has(query: Query, key: string) {
  return query[key] !== undefined;
}

export function cleanText(value: string | null, maxLength = 500) {
  if (value == null) return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

export function boundedInteger(value: string | null, fallback: number, maximum = MAX_LIST_COUNT) {
  if (value == null || value === '') return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= maximum ? parsed : null;
}

export function booleanParameter(value: string | null, fallback: boolean) {
  if (value == null || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return null;
}


export function normalizeEndpoint(value: string) {
  return value.endsWith('.view') ? value.slice(0, -5) : value;
}
