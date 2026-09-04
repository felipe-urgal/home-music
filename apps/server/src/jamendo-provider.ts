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

function normalizeTrack(value: unknown): JamendoTrackSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const track = value as JamendoApiTrack;
  const sourceId = cleanText(track.id, 80);
  const title = cleanText(track.name, 300);
  if (!sourceId || !/^\d+$/.test(sourceId) || !title) return null;

  return Object.freeze({
    sourceId,
    title,
    artist: cleanText(track.artist_name, 300),
    album: cleanText(track.album_name, 300),
    durationSeconds: numberValue(track.duration),
    thumbnailUrl: cleanPublicUrl(track.image) ?? cleanPublicUrl(track.album_image),
    licenseUrl: cleanPublicUrl(track.license_ccurl),
    downloadAllowed: booleanValue(track.audiodownload_allowed),
    previewAvailable: Boolean(cleanPublicUrl(track.audio))
  });
}

function normalizedQuery(value: unknown) {
  const query = cleanText(value, MAX_QUERY_LENGTH);
  if (!query || query.length < 2) {
    throw new ExternalProviderError('invalid_input', 'Informe ao menos 2 caracteres para buscar no Jamendo.');
  }
  return query;
}

function totalFromHeaders(headers: JamendoApiHeaders | undefined) {
  const full = numberValue(headers?.results_fullcount);
  if (full !== null && Number.isSafeInteger(full)) return full;
  return null;
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

  async search(input: JamendoSearchInput, config: ExternalProviderConfig): Promise<JamendoSearchResult> {
    const clientId = requireClientId(config);
    const query = normalizedQuery(input.query);
    const page = positiveInteger(input.page, 1, MAX_PAGE, 'Página');
    const limit = positiveInteger(input.limit, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, 'Limite');
    const offset = (page - 1) * limit;

    const url = new URL(JAMENDO_TRACKS_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('format', 'json');
    url.searchParams.set('search', query);
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('fullcount', 'true');
    url.searchParams.set('audioformat', 'mp32');
    url.searchParams.set('audiodlformat', 'mp32');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();

    let response: Response;
    try {
      response = await this.request(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ExternalProviderError('provider_timeout', 'A busca no Jamendo excedeu o tempo limite.', 504);
      }
      throw new ExternalProviderError('provider_network_failed', 'Não foi possível consultar o Jamendo.', 502);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ExternalProviderError('provider_auth_required', 'A configuração do Jamendo foi recusada.', 503);
    }
    if (response.status === 429) {
      throw new ExternalProviderError('provider_failed', 'O Jamendo limitou temporariamente as buscas.', 503);
    }
    if (!response.ok) {
      throw new ExternalProviderError('provider_network_failed', 'O Jamendo não respondeu à busca.', 502);
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new ExternalProviderError('invalid_output', 'A resposta do Jamendo excedeu o limite permitido.', 502);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw new ExternalProviderError('invalid_output', 'A resposta do Jamendo excedeu o limite permitido.', 502);
    }

    const payload = parseApiResponse(text);
    const items = (payload.results as unknown[])
      .map(normalizeTrack)
      .filter((item): item is JamendoTrackSummary => item !== null);
    const total = totalFromHeaders(payload.headers);
    const hasNext = total === null
      ? items.length === limit
      : offset + items.length < total;

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
}
