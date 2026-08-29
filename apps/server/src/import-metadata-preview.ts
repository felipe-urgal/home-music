import path from 'node:path';
import { parseFile } from 'music-metadata';
import type {
  ImportJob,
  ImportMetadataFieldName,
  ImportMetadataFieldStates,
  ImportMetadataPreview,
  ImportMetadataPreviewPatch,
  ImportMetadataValues
} from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportStagingManager, ImportValidationTarget } from './import-staging.js';
import { normalizeMetadataOverridePatch } from './track-metadata-overrides.js';

const MAX_COVER_BYTES = 8 * 1024 * 1024;
const MAX_COVER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_COVER_CACHE_ITEMS = 64;
const MAX_METADATA_LENGTH = 240;
const SAFE_COVER_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const METADATA_FIELDS: readonly ImportMetadataFieldName[] = ['title', 'artist', 'album', 'albumArtist'];

export type ImportProviderMetadataHint = Readonly<{
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
}>;

export type ImportMetadataReadResult = Readonly<{
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  durationSeconds: number | null;
  cover: Readonly<{
    data: Buffer;
    contentType: string;
  }> | null;
}>;

export type ImportMetadataReader = (target: ImportValidationTarget) => Promise<ImportMetadataReadResult>;

type ImportMetadataPreviewManagerOptions = {
  queue: ImportJobQueue;
  staging: ImportStagingManager;
  validatedLookup: (jobId: string) => unknown | null;
  providerMetadata?: (jobId: string) => ImportProviderMetadataHint | null;
  metadataReader?: ImportMetadataReader;
  now?: () => Date;
};

type SourceSnapshot = {
  embedded: ImportMetadataValues;
  durationSeconds: number | null;
};

type CachedCover = {
  data: Buffer;
  contentType: string;
};

export type ImportMetadataPreviewErrorCode =
  | 'job_not_found'
  | 'job_not_ready'
  | 'media_not_validated'
  | 'preview_not_ready'
  | 'invalid_metadata';

export class ImportMetadataPreviewError extends Error {
  constructor(
    public readonly code: ImportMetadataPreviewErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ImportMetadataPreviewError';
  }
}

function cleanMetadataValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_METADATA_LENGTH);
  return normalized || null;
}

function cleanProviderMetadata(value: ImportProviderMetadataHint | null | undefined): ImportMetadataValues | null {
  if (!value) return null;
  const clean: ImportMetadataValues = {
    title: cleanMetadataValue(value.title),
    artist: cleanMetadataValue(value.artist),
    album: cleanMetadataValue(value.album),
    albumArtist: cleanMetadataValue(value.albumArtist)
  };
  return METADATA_FIELDS.some(field => clean[field]) ? clean : null;
}

function emptyValues(): ImportMetadataValues {
  return { title: null, artist: null, album: null, albumArtist: null };
}

function comparable(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

function sameMetadata(left: string, right: string) {
  return comparable(left) === comparable(right);
}

function uploadFallbackTitle(job: ImportJob) {
  if (job.source.type !== 'upload') return null;
  const base = path.basename(job.label.trim());
  const extension = path.extname(base);
  return cleanMetadataValue(extension ? base.slice(0, -extension.length) : base);
}

function resolveField(
  field: ImportMetadataFieldName,
  embedded: ImportMetadataValues,
  provider: ImportMetadataValues | null,
  overrides: ImportMetadataValues,
  fallback: string | null
) {
  const override = overrides[field];
  if (override) return { value: override, state: 'edited' as const };

  const local = embedded[field];
  const suggested = provider?.[field] ?? null;
  if (local) {
    if (suggested && !sameMetadata(local, suggested)) {
      return { value: local, state: 'conflict' as const };
    }
    return { value: local, state: 'trusted' as const };
  }
  if (fallback) {
    if (suggested && !sameMetadata(fallback, suggested)) {
      return { value: fallback, state: 'conflict' as const };
    }
    return { value: fallback, state: 'fallback' as const };
  }
  if (suggested) return { value: null, state: 'suggested' as const };
  return { value: null, state: 'missing' as const };
}

function buildPreview(
  job: ImportJob,
  snapshot: SourceSnapshot,
  provider: ImportMetadataValues | null,
  overrides: ImportMetadataValues,
  cover: CachedCover | null,
  generatedAt: string
): ImportMetadataPreview {
  const fallbackTitle = uploadFallbackTitle(job);
  const title = resolveField('title', snapshot.embedded, provider, overrides, fallbackTitle);
  const artist = resolveField('artist', snapshot.embedded, provider, overrides, null);
  const album = resolveField('album', snapshot.embedded, provider, overrides, null);
  const albumArtist = resolveField(
    'albumArtist',
    snapshot.embedded,
    provider,
    overrides,
    artist.value
  );

  const fieldStates: ImportMetadataFieldStates = {
    title: title.state,
    artist: artist.state,
    album: album.state,
    albumArtist: albumArtist.state
  };

  return {
    embedded: { ...snapshot.embedded },
    provider: provider ? { ...provider } : null,
    overrides: { ...overrides },
    effective: {
      title: title.value,
      artist: artist.value,
      album: album.value,
      albumArtist: albumArtist.value
    },
    fieldStates,
    durationSeconds: job.mediaDecision?.input.durationSeconds ?? snapshot.durationSeconds ?? 0,
    cover: cover
      ? { available: true, contentType: cover.contentType, sizeBytes: cover.data.byteLength }
      : { available: false, contentType: null, sizeBytes: null },
    generatedAt
  };
}

export const readImportMetadata: ImportMetadataReader = async target => {
  const metadata = await parseFile(target.path, { duration: true });
  const picture = metadata.common.picture?.[0];
  const cover = picture
    && SAFE_COVER_TYPES.has(picture.format)
    && picture.data.byteLength > 0
    && picture.data.byteLength <= MAX_COVER_BYTES
      ? { data: Buffer.from(picture.data), contentType: picture.format }
      : null;

  return {
    title: cleanMetadataValue(metadata.common.title),
    artist: cleanMetadataValue(metadata.common.artist),
    album: cleanMetadataValue(metadata.common.album),
    albumArtist: cleanMetadataValue(metadata.common.albumartist),
    durationSeconds: typeof metadata.format.duration === 'number' && Number.isFinite(metadata.format.duration)
      ? metadata.format.duration
      : null,
    cover
  };
};

export class ImportMetadataPreviewManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly validatedLookup: (jobId: string) => unknown | null;
  private readonly providerMetadata?: (jobId: string) => ImportProviderMetadataHint | null;
  private readonly metadataReader: ImportMetadataReader;
  private readonly now: () => Date;
  private readonly snapshots = new Map<string, SourceSnapshot>();
  private readonly covers = new Map<string, CachedCover>();
  private coverCacheBytes = 0;

  constructor(options: ImportMetadataPreviewManagerOptions) {
    this.queue = options.queue;
    this.staging = options.staging;
    this.validatedLookup = options.validatedLookup;
    this.providerMetadata = options.providerMetadata;
    this.metadataReader = options.metadataReader ?? readImportMetadata;
    this.now = options.now ?? (() => new Date());
  }

  async captureSource(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportMetadataPreviewError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportMetadataPreviewError('job_not_ready', 'O job precisa estar pendente para ler metadata.', 409);
    }

    let read: ImportMetadataReadResult;
    try {
      read = await this.staging.inspectPayload(jobId, target => this.metadataReader(target));
    } catch {
      read = {
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        durationSeconds: null,
        cover: null
      };
    }

    const snapshot: SourceSnapshot = {
      embedded: {
        title: cleanMetadataValue(read.title),
        artist: cleanMetadataValue(read.artist),
        album: cleanMetadataValue(read.album),
        albumArtist: cleanMetadataValue(read.albumArtist)
      },
      durationSeconds: typeof read.durationSeconds === 'number' && Number.isFinite(read.durationSeconds) && read.durationSeconds > 0
        ? read.durationSeconds
        : null
    };
    this.snapshots.set(jobId, snapshot);
    this.cacheCover(jobId, read.cover);
    return { embedded: { ...snapshot.embedded }, durationSeconds: snapshot.durationSeconds };
  }

  async extract(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportMetadataPreviewError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportMetadataPreviewError('job_not_ready', 'O job precisa estar pendente para gerar o preview.', 409);
    }
    if (!job.mediaDecision || !this.validatedLookup(jobId)) {
      throw new ImportMetadataPreviewError(
        'media_not_validated',
        'Valide tecnicamente a mídia antes de gerar o preview.',
        409
      );
    }

    this.queue.transition(jobId, 'processing');
    try {
      if (!this.snapshots.has(jobId)) await this.captureCurrentPayload(jobId);
      const current = this.queue.get(jobId)!;
      const snapshot = this.snapshots.get(jobId)!;
      const provider = cleanProviderMetadata(this.providerMetadata?.(jobId));
      const preview = buildPreview(
        current,
        snapshot,
        provider,
        emptyValues(),
        this.covers.get(jobId) ?? null,
        this.now().toISOString()
      );
      this.queue.setMetadataPreview(jobId, preview);
      const ready = this.queue.transition(jobId, 'pending')!;
      return { job: ready, preview };
    } catch (error) {
      const current = this.queue.get(jobId);
      if (current?.status === 'processing') this.queue.transition(jobId, 'pending');
      if (error instanceof ImportMetadataPreviewError) throw error;
      throw new ImportMetadataPreviewError('invalid_metadata', 'Não foi possível gerar o preview da metadata.', 422);
    }
  }

  update(jobId: string, rawPatch: unknown) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportMetadataPreviewError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportMetadataPreviewError('job_not_ready', 'O job precisa estar pendente para ajustar metadata.', 409);
    }
    if (!job.metadataPreview) {
      throw new ImportMetadataPreviewError('preview_not_ready', 'Gere o preview antes de ajustar metadata.', 409);
    }

    let patch: ImportMetadataPreviewPatch;
    try {
      patch = normalizeMetadataOverridePatch(rawPatch) as ImportMetadataPreviewPatch;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Metadados inválidos.';
      throw new ImportMetadataPreviewError('invalid_metadata', message, 400);
    }

    const snapshot = this.snapshots.get(jobId) ?? {
      embedded: { ...job.metadataPreview.embedded },
      durationSeconds: job.metadataPreview.durationSeconds
    };
    const provider = job.metadataPreview.provider ? { ...job.metadataPreview.provider } : null;
    const overrides = { ...job.metadataPreview.overrides };
    for (const field of METADATA_FIELDS) {
      if (!(field in patch)) continue;
      overrides[field] = cleanMetadataValue(patch[field]);
    }

    const preview = buildPreview(
      job,
      snapshot,
      provider,
      overrides,
      this.covers.get(jobId) ?? null,
      this.now().toISOString()
    );
    const updated = this.queue.setMetadataPreview(jobId, preview)!;
    return { job: updated, preview };
  }

  getCover(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job?.metadataPreview?.cover.available) return null;
    const cover = this.covers.get(jobId);
    if (!cover) return null;
    this.covers.delete(jobId);
    this.covers.set(jobId, cover);
    return { data: Buffer.from(cover.data), contentType: cover.contentType };
  }

  forget(jobId: string) {
    this.snapshots.delete(jobId);
    const cover = this.covers.get(jobId);
    if (cover) this.coverCacheBytes -= cover.data.byteLength;
    this.covers.delete(jobId);
  }

  private async captureCurrentPayload(jobId: string) {
    let read: ImportMetadataReadResult;
    try {
      read = await this.staging.inspectPayload(jobId, target => this.metadataReader(target));
    } catch {
      read = {
        title: null,
        artist: null,
        album: null,
        albumArtist: null,
        durationSeconds: null,
        cover: null
      };
    }
    this.snapshots.set(jobId, {
      embedded: {
        title: cleanMetadataValue(read.title),
        artist: cleanMetadataValue(read.artist),
        album: cleanMetadataValue(read.album),
        albumArtist: cleanMetadataValue(read.albumArtist)
      },
      durationSeconds: read.durationSeconds
    });
    this.cacheCover(jobId, read.cover);
  }

  private cacheCover(jobId: string, value: ImportMetadataReadResult['cover']) {
    const previous = this.covers.get(jobId);
    if (previous) this.coverCacheBytes -= previous.data.byteLength;
    this.covers.delete(jobId);

    if (!value || !SAFE_COVER_TYPES.has(value.contentType) || value.data.byteLength <= 0 || value.data.byteLength > MAX_COVER_BYTES) {
      return;
    }

    const cover = { data: Buffer.from(value.data), contentType: value.contentType };
    this.covers.set(jobId, cover);
    this.coverCacheBytes += cover.data.byteLength;

    while (this.covers.size > MAX_COVER_CACHE_ITEMS || this.coverCacheBytes > MAX_COVER_CACHE_BYTES) {
      const oldestJobId = this.covers.keys().next().value as string | undefined;
      if (!oldestJobId) break;
      const oldest = this.covers.get(oldestJobId);
      if (oldest) this.coverCacheBytes -= oldest.data.byteLength;
      this.covers.delete(oldestJobId);
    }
  }
}
