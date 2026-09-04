import {
  ExternalProviderError,
  type ExternalProvider,
  type ExternalProviderConfig,
  type ExternalProviderContext,
  type ExternalProviderPreparedMedia,
  type ExternalProviderRequest
} from './external-provider.js';

export const JAMENDO_PROVIDER_ID = 'jamendo';
export const JAMENDO_CLIENT_ID_CONFIG = 'client-id';

const JAMENDO_TRACKS_URL = 'https://api.jamendo.com/v3.0/tracks/';
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const MAX_PAGE = 500;
const MAX_QUERY_LENGTH = 120;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 8_000;
const CREATIVE_COMMONS_HOSTS = new Set(['creativecommons.org', 'www.creativecommons.org']);
const CREATIVE_COMMONS_LICENSE_PATH = /^\/licenses\/(?:by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/\d+(?:\.\d+)*\/?$/i;
const CREATIVE_COMMONS_PUBLIC_DOMAIN_PATH = /^\/publicdomain\/(?:zero|mark)\/\d+(?:\.\d+)*\/?$/i;

type JamendoFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type JamendoApiHeaders = {
  status?: unknown;
  code?: unknown;
  error_message?: unknown;
  results_count?: unknown;
  results_fullcount?: unknown;
};

type JamendoApiTrack = {
  id?: unknown;
  name?: unknown;
  artist_name?: unknown;
  album_name?: unknown;
  duration?: unknown;
  image?: unknown;
  album_image?: unknown;
  license_ccurl?: unknown;
  audio?: unknown;
  audiodownload?: unknown;
  audiodownload_allowed?: unknown;
};

type JamendoApiResponse = {
  headers?: JamendoApiHeaders;
  results?: unknown;
};

export type JamendoImportBlockReason =
  | 'download-not-allowed'
  | 'license-missing'
  | 'license-unsupported';

export type JamendoTrackSummary = Readonly<{
  sourceId: string;
  title: string;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  licenseUrl: string | null;
  downloadAllowed: boolean;
  previewAvailable: boolean;
  importAllowed: boolean;
  importBlockReason: JamendoImportBlockReason | null;
  attribution: string;
}>;

export type JamendoSearchResult = Readonly<{
  items: readonly JamendoTrackSummary[];
  pagination: Readonly<{
    page: number;
    limit: number;
    total: number | null;
    nextPage: number | null;
  }>;
}>;

type JamendoSearchInput = Readonly<{
  query: unknown;
  page?: unknown;
  limit?: unknown;
}>;

type JamendoProviderOptions = Readonly<{
  fetch?: JamendoFetch;
  timeoutMs?: number;
}>;

function cleanText(value: unknown, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function cleanPublicUrl(value: unknown) {
  const raw = cleanText(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown, fallback: number, max: number, label: string) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value)
      : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new ExternalProviderError('invalid_input', `${label} inválido para a busca no Jamendo.`);
  }
  return parsed;
}

function requireClientId(config: ExternalProviderConfig) {
  const clientId = config[JAMENDO_CLIENT_ID_CONFIG]?.trim() ?? '';
  if (!clientId || clientId.length > 256 || /[\u0000-\u001f\u007f]/.test(clientId)) {
    throw new ExternalProviderError(
      'provider_not_configured',
      'O provider Jamendo não está configurado.',
      503
    );
  }
  return clientId;
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function licenseImportBlockReason(licenseUrl: string | null): JamendoImportBlockReason | null {
  if (!licenseUrl) return 'license-missing';
  try {
    const url = new URL(licenseUrl);
    if (!CREATIVE_COMMONS_HOSTS.has(url.hostname.toLowerCase())) return 'license-unsupported';
    if (CREATIVE_COMMONS_LICENSE_PATH.test(url.pathname) || CREATIVE_COMMONS_PUBLIC_DOMAIN_PATH.test(url.pathname)) {
      return null;
    }
  } catch {
    // URL já foi higienizada, mas a política permanece fail-closed.
  }
  return 'license-unsupported';
}

export function jamendoImportBlockReason(
  downloadAllowed: boolean,
  licenseUrl: string | null
): JamendoImportBlockReason | null {
  if (!downloadAllowed) return 'download-not-allowed';
  return licenseImportBlockReason(licenseUrl);
}

function normalizeTrack(value: unknown): JamendoTrackSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const track = value as JamendoApiTrack;
  const sourceId = cleanText(track.id, 80);
  const title = cleanText(track.name, 300);
  if (!sourceId || !/^\d+$/.test(sourceId) || !title) return null;

  const artist = cleanText(track.artist_name, 300);
  const licenseUrl = cleanPublicUrl(track.license_ccurl);
  const downloadAllowed = booleanValue(track.audiodownload_allowed);
  const importBlockReason = jamendoImportBlockReason(downloadAllowed, licenseUrl);

  return Object.freeze({
    sourceId,
    title,
    artist,
    album: cleanText(track.album_name, 300),
    durationSeconds: numberValue(track.duration),
    thumbnailUrl: cleanPublicUrl(track.image) ?? cleanPublicUrl(track.album_image),
    licenseUrl,
    downloadAllowed,
    previewAvailable: Boolean(cleanPublicUrl(track.audio)),
    importAllowed: importBlockReason === null,
    importBlockReason,
    attribution: `“${title}” — ${artist ?? 'Artista não informado'} · Jamendo`
  });
}

function normalizedQuery(value: unknown) {
  const query = cleanText(value, MAX_QUERY_LENGTH);
  if (!query || query.length < 2) {
    throw new ExternalProviderError('invalid_input', 'Informe ao menos 2 caracteres para buscar no Jamendo.');
  }
  return query;
}

function normalizedSourceId(value: unknown) {
  const sourceId = cleanText(value, 80);
  if (!sourceId || !/^\d+$/.test(sourceId)) {
    throw new ExternalProviderError('invalid_input', 'Faixa do Jamendo inválida.');
  }
  return sourceId;
}

function totalFromHeaders(headers: JamendoApiHeaders | undefined) {
  const full = numberValue(headers?.results_fullcount);
  if (full !== null && Number.isSafeInteger(full)) return full;
  return null;
}

function responseTooLargeError() {
  return new ExternalProviderError('invalid_output', 'A resposta do Jamendo excedeu o limite permitido.', 502);
}

async function readBoundedResponse(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw responseTooLargeError();
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw responseTooLargeError();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function parseApiResponse(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExternalProviderError('invalid_output', 'O Jamendo retornou uma resposta inválida.', 502);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ExternalProviderError('invalid_output', 'O Jamendo retornou uma resposta inválida.', 502);
  }
  const response = parsed as JamendoApiResponse;
  if (response.headers?.status && response.headers.status !== 'success') {
    throw new ExternalProviderError('provider_failed', 'O Jamendo recusou a busca solicitada.', 502);
  }
  if (!Array.isArray(response.results)) {
    throw new ExternalProviderError('invalid_output', 'O Jamendo retornou uma lista de faixas inválida.', 502);
  }
  return response;
}

function importBlockedMessage(reason: JamendoImportBlockReason) {
  switch (reason) {
    case 'download-not-allowed':
      return 'Esta faixa não permite download pela API do Jamendo.';
    case 'license-missing':
      return 'Esta faixa não possui licença verificável para importação.';
    case 'license-unsupported':
      return 'A licença desta faixa não é reconhecida como permitida para importação.';
  }
}

export class JamendoProvider implements ExternalProvider {
  readonly id = JAMENDO_PROVIDER_ID;
  readonly label = 'Jamendo · música livre/licenciada';
  readonly capabilities = Object.freeze({
    audio: false,
    metadata: true,
    thumbnail: true,
    playlists: false
  });
  readonly requiredConfigKeys = Object.freeze([JAMENDO_CLIENT_ID_CONFIG]);

  private readonly request: JamendoFetch;
  private readonly timeoutMs: number;

  constructor(options: JamendoProviderOptions = {}) {
    this.request = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0 || this.timeoutMs > 60_000) {
      throw new Error('Timeout do Jamendo inválido.');
    }
  }

  validate(_request: ExternalProviderRequest) {
    throw new ExternalProviderError(
      'invalid_input',
      'A importação física do Jamendo ainda não está habilitada; use a descoberta de faixas.'
    );
  }

  async prepare(
    _request: ExternalProviderRequest,
    _context: ExternalProviderContext
  ): Promise<ExternalProviderPreparedMedia> {
    throw new ExternalProviderError(
      'provider_failed',
      'A importação física do Jamendo ainda não está habilitada.',
      409
    );
  }

  private async requestTracks(
    config: ExternalProviderConfig,
    parameters: Readonly<Record<string, string>>
  ) {
    const clientId = requireClientId(config);
    const url = new URL(JAMENDO_TRACKS_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('audioformat', 'mp32');
    url.searchParams.set('audiodlformat', 'mp32');
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    try {
      const response = await this.request(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new ExternalProviderError('provider_auth_required', 'A configuração do Jamendo foi recusada.', 503);
      }
      if (response.status === 429) {
        throw new ExternalProviderError('provider_failed', 'O Jamendo limitou temporariamente as buscas.', 503);
      }
      if (!response.ok) {
        throw new ExternalProviderError('provider_network_failed', 'O Jamendo não respondeu à solicitação.', 502);
      }

      return parseApiResponse(await readBoundedResponse(response));
    } catch (error) {
      if (error instanceof ExternalProviderError) throw error;
      if (controller.signal.aborted) {
        throw new ExternalProviderError('provider_timeout', 'A consulta ao Jamendo excedeu o tempo limite.', 504);
      }
      throw new ExternalProviderError('provider_network_failed', 'Não foi possível consultar o Jamendo.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(input: JamendoSearchInput, config: ExternalProviderConfig): Promise<JamendoSearchResult> {
    const query = normalizedQuery(input.query);
    const page = positiveInteger(input.page, 1, MAX_PAGE, 'Página');
    const limit = positiveInteger(input.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 'Limite');
    const offset = (page - 1) * limit;

    const payload = await this.requestTracks(config, {
      search: query,
      order: 'relevance',
      limit: String(limit),
      offset: String(offset),
      fullcount: 'true'
    });
    const rawItems = payload.results as unknown[];
    const items = rawItems
      .map(normalizeTrack)
      .filter((item): item is JamendoTrackSummary => item !== null);
    const total = totalFromHeaders(payload.headers);
    const hasNext = total === null
      ? rawItems.length === limit
      : offset + rawItems.length < total;

    return Object.freeze({
      items: Object.freeze(items),
      pagination: Object.freeze({
        page,
        limit,
        total,
        nextPage: hasNext && page < MAX_PAGE ? page + 1 : null
      })
    });
  }

  async inspectImportEligibility(sourceIdValue: unknown, config: ExternalProviderConfig) {
    const sourceId = normalizedSourceId(sourceIdValue);
    const payload = await this.requestTracks(config, { id: sourceId, limit: '1' });
    const track = (payload.results as unknown[])
      .map(normalizeTrack)
      .find(candidate => candidate?.sourceId === sourceId) ?? null;

    if (!track) {
      throw new ExternalProviderError('invalid_input', 'A faixa do Jamendo não está mais disponível.', 404);
    }
    if (!track.importAllowed && track.importBlockReason) {
      throw new ExternalProviderError('invalid_input', importBlockedMessage(track.importBlockReason), 409);
    }
    return track;
  }
}
