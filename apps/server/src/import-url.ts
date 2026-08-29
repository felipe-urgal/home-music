import { lookup } from 'node:dns/promises';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import type { ImportJob } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportStagingManager, ImportValidationTarget } from './import-staging.js';

export const DEFAULT_IMPORT_URL_MAX_MEGABYTES = 512;
export const DEFAULT_IMPORT_URL_TIMEOUT_SECONDS = 120;
export const DEFAULT_IMPORT_URL_MAX_REDIRECTS = 3;
const MAX_IMPORT_URL_MEGABYTES = 8192;
const MAX_IMPORT_URL_TIMEOUT_SECONDS = 900;
const MAX_IMPORT_URL_REDIRECTS = 10;
const MAX_URL_BYTES = 4096;

const ALLOWED_CONTENT_TYPES = new Set([
  'audio/mpeg',
  'audio/flac',
  'audio/x-flac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/mp4a-latm',
  'audio/aac',
  'audio/ogg',
  'application/ogg',
  'application/octet-stream'
]);

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type ImportUrlConfig = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  acceptedProtocols: string[];
};

type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

type UrlSession = {
  jobId: string;
  request: ReturnType<typeof http.request> | null;
  response: IncomingMessage | null;
  cancelRequested: boolean;
  timedOut: boolean;
  completed: boolean;
  settled: Promise<void>;
  resolveSettled: () => void;
  abortPromise: Promise<never>;
  rejectAbort: (error: Error) => void;
};

type ImportUrlManagerOptions = {
  queue: ImportJobQueue;
  staging: ImportStagingManager;
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  requestUrl?: (
    url: URL,
    address: ResolvedAddress,
    timeoutMs: number
  ) => Promise<{ response: IncomingMessage; request: ReturnType<typeof http.request> }>;
  validateAudio?: (target: ImportValidationTarget) => Promise<void>;
};

export class ImportUrlError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ImportUrlError';
    this.statusCode = statusCode;
  }
}

class ImportUrlCancelledError extends Error {
  constructor() {
    super('Importação por URL cancelada.');
    this.name = 'ImportUrlCancelledError';
  }
}

export function parseImportUrlMaxMegabytes(value: string | undefined) {
  return parseIntegerConfig(
    value,
    DEFAULT_IMPORT_URL_MAX_MEGABYTES,
    1,
    MAX_IMPORT_URL_MEGABYTES,
    'HOME_MUSIC_IMPORT_URL_MAX_MB'
  );
}

export function parseImportUrlTimeoutSeconds(value: string | undefined) {
  return parseIntegerConfig(
    value,
    DEFAULT_IMPORT_URL_TIMEOUT_SECONDS,
    5,
    MAX_IMPORT_URL_TIMEOUT_SECONDS,
    'HOME_MUSIC_IMPORT_URL_TIMEOUT_SECONDS'
  );
}

export function parseImportUrlMaxRedirects(value: string | undefined) {
  return parseIntegerConfig(
    value,
    DEFAULT_IMPORT_URL_MAX_REDIRECTS,
    0,
    MAX_IMPORT_URL_REDIRECTS,
    'HOME_MUSIC_IMPORT_URL_MAX_REDIRECTS'
  );
}

function parseIntegerConfig(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string
) {
  if (value == null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ImportUrlError(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return parsed;
}

function unbracketHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function parseUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ImportUrlError('URL obrigatória.');
  }
  const raw = value.trim();
  if (Buffer.byteLength(raw, 'utf8') > MAX_URL_BYTES) {
    throw new ImportUrlError('URL excede o limite de tamanho.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportUrlError('URL inválida.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportUrlError('Somente URLs HTTP e HTTPS são permitidas.');
  }
  if (url.username || url.password) {
    throw new ImportUrlError('URLs com credenciais embutidas não são permitidas.');
  }
  if (url.hash) url.hash = '';

  const expectedPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== expectedPort) {
    throw new ImportUrlError('Somente as portas padrão HTTP/HTTPS são permitidas.');
  }

  const hostname = unbracketHostname(url.hostname).toLowerCase();
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
  ) {
    throw new ImportUrlError('O endereço informado não pode apontar para a rede local.');
  }

  return url;
}

function normalizeIp(address: string) {
  const zoneIndex = address.indexOf('%');
  return (zoneIndex >= 0 ? address.slice(0, zoneIndex) : address).toLowerCase();
}

function ipv4ToNumber(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function ipv4InCidr(value: number, base: string, prefix: number) {
  const baseValue = ipv4ToNumber(base);
  if (baseValue == null) return false;
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isUnsafeIpv4(address: string) {
  const value = ipv4ToNumber(address);
  if (value == null) return true;
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ].some(([base, prefix]) => ipv4InCidr(value, base as string, prefix as number));
}

function expandIpv6(address: string) {
  const normalized = normalizeIp(address);
  const dottedMapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dottedMapped) return { mappedIpv4: dottedMapped[1], groups: null };

  const halves = normalized.split('::');
  if (halves.length > 2) return { mappedIpv4: null, groups: null };
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return { mappedIpv4: null, groups: null };
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8) return { mappedIpv4: null, groups: null };
  const parsed = groups.map(group => Number.parseInt(group || '0', 16));
  if (parsed.some(group => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return { mappedIpv4: null, groups: null };
  }
  return { mappedIpv4: null, groups: parsed };
}

function ipv4FromIpv6Tail(groups: number[]) {
  const high = groups[6];
  const low = groups[7];
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

function isUnsafeIpv6(address: string) {
  const expanded = expandIpv6(address);
  if (expanded.mappedIpv4) return isUnsafeIpv4(expanded.mappedIpv4);
  const groups = expanded.groups;
  if (!groups) return true;
  if (groups.every(group => group === 0)) return true;
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return true;

  const mappedHex = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
  if (mappedHex) return isUnsafeIpv4(ipv4FromIpv6Tail(groups));
  const compatibleIpv4 = groups.slice(0, 6).every(group => group === 0);
  if (compatibleIpv4) return isUnsafeIpv4(ipv4FromIpv6Tail(groups));

  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if ((groups[0] & 0xff00) === 0xff00) return true;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true;
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0x0000) return true;
  if (groups[0] === 0x0064 && groups[1] === 0xff9b && groups[2] === 0x0001) return true;
  return false;
}

export function isUnsafeImportAddress(address: string) {
  const normalized = normalizeIp(unbracketHostname(address));
  const family = net.isIP(normalized);
  if (family === 4) return isUnsafeIpv4(normalized);
  if (family === 6) return isUnsafeIpv6(normalized);
  return true;
}

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const normalizedHostname = unbracketHostname(hostname);
  const literalFamily = net.isIP(normalizedHostname);
  if (literalFamily === 4 || literalFamily === 6) {
    return [{ address: normalizedHostname, family: literalFamily }];
  }
  const results = await lookup(normalizedHostname, { all: true, verbatim: true });
  return results.map(item => ({ address: item.address, family: item.family }));
}

async function resolveSafeAddress(
  hostname: string,
  resolver: (hostname: string) => Promise<ResolvedAddress[]>
) {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(unbracketHostname(hostname));
  } catch {
    throw new ImportUrlError('Não foi possível resolver o endereço remoto.', 502);
  }
  if (addresses.length === 0) {
    throw new ImportUrlError('O endereço remoto não possui IP utilizável.', 502);
  }
  if (addresses.some(item => isUnsafeImportAddress(item.address))) {
    throw new ImportUrlError('O endereço remoto aponta para uma rede não permitida.');
  }
  return addresses[0];
}

function createPinnedRequest(
  url: URL,
  resolved: ResolvedAddress,
  timeoutMs: number
): Promise<{ response: IncomingMessage; request: ReturnType<typeof http.request> }> {
  return new Promise((resolve, reject) => {
    const commonOptions: http.RequestOptions = {
      host: resolved.address,
      family: resolved.family,
      port: url.protocol === 'https:' ? 443 : 80,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      headers: {
        Host: url.host,
        Accept: 'audio/*, application/octet-stream;q=0.8',
        'User-Agent': 'Home-Music/0.1 URL Import'
      },
      timeout: timeoutMs
    };

    const onResponse = (response: IncomingMessage) => resolve({ response, request });
    const request = url.protocol === 'https:'
      ? https.request({
          ...commonOptions,
          servername: net.isIP(unbracketHostname(url.hostname)) ? undefined : unbracketHostname(url.hostname)
        }, onResponse)
      : http.request(commonOptions, onResponse);

    request.once('timeout', () => request.destroy(new ImportUrlError('Tempo limite excedido ao baixar a URL.', 504)));
    request.once('error', reject);
    request.end();
  });
}

function contentType(headers: IncomingHttpHeaders) {
  const raw = headers['content-type'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.split(';', 1)[0]?.trim().toLowerCase() || '';
}

function contentLength(headers: IncomingHttpHeaders) {
  const raw = headers['content-length'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function redirectLocation(headers: IncomingHttpHeaders) {
  const raw = headers.location;
  return Array.isArray(raw) ? raw[0] : raw;
}

function safeJobLabel(url: URL) {
  const base = path.posix.basename(url.pathname) || 'arquivo remoto';
  return `${unbracketHostname(url.hostname)} · ${base}`.slice(0, 240);
}

async function defaultValidateAudio(target: ImportValidationTarget) {
  try {
    const metadata = await parseFile(target.path, { duration: true, skipCovers: true });
    if (!metadata.format.container || !metadata.format.numberOfChannels) {
      throw new Error('Formato de áudio não reconhecido.');
    }
  } catch {
    throw new ImportUrlError('O conteúdo recebido não foi reconhecido como áudio suportado.');
  }
}

function timeoutError() {
  return new ImportUrlError('Tempo limite excedido ao baixar a URL.', 504);
}

export class ImportUrlManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;
  private readonly resolveHost: (hostname: string) => Promise<ResolvedAddress[]>;
  private readonly requestUrl: NonNullable<ImportUrlManagerOptions['requestUrl']>;
  private readonly validateAudio: NonNullable<ImportUrlManagerOptions['validateAudio']>;
  private readonly sessions = new Map<string, UrlSession>();

  constructor(options: ImportUrlManagerOptions) {
    this.queue = options.queue;
    this.staging = options.staging;
    this.maxBytes = options.maxBytes;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_IMPORT_URL_TIMEOUT_SECONDS * 1000;
    this.maxRedirects = options.maxRedirects ?? DEFAULT_IMPORT_URL_MAX_REDIRECTS;
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
    this.requestUrl = options.requestUrl ?? createPinnedRequest;
    this.validateAudio = options.validateAudio ?? defaultValidateAudio;
  }

  get config(): ImportUrlConfig {
    return {
      maxBytes: this.maxBytes,
      timeoutMs: this.timeoutMs,
      maxRedirects: this.maxRedirects,
      acceptedProtocols: ['http:', 'https:']
    };
  }

  async start(urlInput: unknown): Promise<{ job: ImportJob }> {
    const url = parseUrl(urlInput);
    const job = this.queue.enqueue({ type: 'url', provider: null }, safeJobLabel(url));

    try {
      await this.staging.createJob(job.id);
    } catch (error) {
      this.queue.transition(job.id, 'failed', 'Não foi possível preparar o staging da URL.');
      throw error;
    }

    let resolveSettled!: () => void;
    const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
    let rejectAbort!: (error: Error) => void;
    const abortPromise = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const session: UrlSession = {
      jobId: job.id,
      request: null,
      response: null,
      cancelRequested: false,
      timedOut: false,
      completed: false,
      settled,
      resolveSettled,
      abortPromise,
      rejectAbort
    };
    this.sessions.set(job.id, session);
    this.queue.transition(job.id, 'processing');
    void this.download(session, url);
    return { job: this.queue.get(job.id)! };
  }

  async cancel(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportUrlError('Job de importação não encontrado.', 404);
    if (job.source.type !== 'url') {
      throw new ImportUrlError('Este job não pertence a uma importação por URL.', 409);
    }
    if (job.status !== 'processing' && job.status !== 'pending') {
      throw new ImportUrlError('Este job não pode mais ser cancelado.', 409);
    }

    const session = this.sessions.get(jobId);
    if (session && !session.completed) {
      session.cancelRequested = true;
      const error = new ImportUrlCancelledError();
      session.rejectAbort(error);
      session.request?.destroy(error);
      session.response?.destroy(error);
      await session.settled.catch(() => undefined);
    }

    await this.staging.cleanupJob(jobId).catch(() => undefined);
    const current = this.queue.get(jobId);
    if (current?.status === 'processing' || current?.status === 'pending') {
      this.queue.transition(jobId, 'cancelled');
    }
    this.sessions.delete(jobId);
    return this.queue.get(jobId)!;
  }

  private async download(session: UrlSession, initialUrl: URL) {
    const timeout = setTimeout(() => {
      if (session.completed || session.cancelRequested) return;
      session.timedOut = true;
      const error = timeoutError();
      session.rejectAbort(error);
      session.request?.destroy(error);
      session.response?.destroy(error);
    }, this.timeoutMs);
    timeout.unref?.();

    try {
      let currentUrl = initialUrl;
      let response: IncomingMessage | null = null;

      for (let redirects = 0; redirects <= this.maxRedirects; redirects += 1) {
        this.ensureActive(session);
        const resolved = await Promise.race([
          resolveSafeAddress(currentUrl.hostname, this.resolveHost),
          session.abortPromise
        ]);
        this.ensureActive(session);
        const result = await Promise.race([
          this.requestUrl(currentUrl, resolved, this.timeoutMs),
          session.abortPromise
        ]);
        this.ensureActive(session);
        session.request = result.request;
        session.response = result.response;
        response = result.response;

        const statusCode = response.statusCode ?? 0;
        if (!REDIRECT_STATUS.has(statusCode)) break;

        const location = redirectLocation(response.headers);
        response.resume();
        if (!location) throw new ImportUrlError('Redirecionamento remoto sem destino.', 502);
        if (redirects >= this.maxRedirects) {
          throw new ImportUrlError('A URL excedeu o limite de redirecionamentos.', 502);
        }
        currentUrl = parseUrl(new URL(location, currentUrl).toString());
        session.response = null;
        session.request = null;
      }

      this.ensureActive(session);
      if (!response) throw new ImportUrlError('Servidor remoto não retornou conteúdo.', 502);
      const statusCode = response.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        throw new ImportUrlError(`Servidor remoto respondeu com HTTP ${statusCode}.`, 502);
      }

      const type = contentType(response.headers);
      if (!type || !ALLOWED_CONTENT_TYPES.has(type)) {
        response.resume();
        throw new ImportUrlError('O servidor remoto não retornou um Content-Type de áudio permitido.');
      }

      const declaredLength = contentLength(response.headers);
      if (declaredLength != null && declaredLength > this.maxBytes) {
        response.resume();
        throw new ImportUrlError('O arquivo remoto excede o limite configurado.', 413);
      }

      await this.staging.writePayload(session.jobId, this.limitChunks(session, response));
      this.ensureActive(session);
      clearTimeout(timeout);
      session.request = null;
      session.response = null;

      await this.staging.inspectPayload(session.jobId, this.validateAudio);
      if (session.cancelRequested) throw new ImportUrlCancelledError();

      const current = this.queue.get(session.jobId);
      if (current?.status === 'processing') this.queue.transition(session.jobId, 'pending');
      session.completed = true;
    } catch (error) {
      await this.staging.cleanupJob(session.jobId).catch(() => undefined);
      const current = this.queue.get(session.jobId);
      if (current?.status === 'processing' || current?.status === 'pending') {
        if (session.cancelRequested || error instanceof ImportUrlCancelledError) {
          this.queue.transition(session.jobId, 'cancelled');
        } else {
          const message = error instanceof ImportUrlError
            ? error.message
            : session.timedOut
              ? timeoutError().message
              : 'Falha ao baixar a mídia remota.';
          this.queue.transition(session.jobId, 'failed', message);
        }
      }
      if (!(session.cancelRequested || error instanceof ImportUrlCancelledError)) {
        this.sessions.delete(session.jobId);
      }
    } finally {
      clearTimeout(timeout);
      session.request = null;
      session.response = null;
      session.resolveSettled();
    }
  }

  private ensureActive(session: UrlSession) {
    if (session.cancelRequested) throw new ImportUrlCancelledError();
    if (session.timedOut) throw timeoutError();
  }

  private async *limitChunks(session: UrlSession, response: IncomingMessage) {
    let receivedBytes = 0;
    for await (const chunk of response) {
      this.ensureActive(session);
      const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      receivedBytes += bytes.byteLength;
      if (receivedBytes > this.maxBytes) {
        throw new ImportUrlError('O arquivo remoto excede o limite configurado.', 413);
      }
      yield bytes;
    }
    if (receivedBytes === 0) throw new ImportUrlError('O servidor remoto retornou um arquivo vazio.');
    this.ensureActive(session);
  }
}
