import { lstat, mkdir, realpath, rmdir } from 'node:fs/promises';
import path from 'node:path';
import type { ImportJob } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportStagingManager, PromotedImportFile, ValidatedImportPayload } from './import-staging.js';
import { isPathInside, resolveLibraryRoot } from './security.js';

const DEFAULT_IMPORT_FOLDER = 'Importados';
const MAX_FOLDER_PATH_BYTES = 1024;
const MAX_FOLDER_COMPONENT_BYTES = 180;
const MAX_FILE_STEM_BYTES = 180;
const MAX_COLLISION_ATTEMPTS = 1_000;
const PROBLEMATIC_PORTABLE_CHARS = /[<>:"|?*]/;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const SUPPORTED_OUTPUT_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus']);

export type ImportDestinationPlan = Readonly<{
  folderPath: string;
  fileName: string;
  relativePath: string;
  collisionIndex: number;
}>;

export type ImportPromotionResult = Readonly<{
  job: ImportJob;
  destination: ImportDestinationPlan;
}>;

type ImportSafeDestinationManagerOptions = {
  queue: ImportJobQueue;
  staging: ImportStagingManager;
  validatedLookup: (jobId: string) => ValidatedImportPayload<unknown> | null;
  duplicateReady: (jobId: string) => boolean;
  musicDir?: string;
};

export type ImportSafeDestinationErrorCode =
  | 'job_not_found'
  | 'job_not_ready'
  | 'media_not_validated'
  | 'metadata_not_ready'
  | 'duplicates_not_ready'
  | 'invalid_destination'
  | 'destination_unavailable'
  | 'promotion_failed';

export class ImportSafeDestinationError extends Error {
  constructor(
    public readonly code: ImportSafeDestinationErrorCode,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'ImportSafeDestinationError';
  }
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function missing(error: unknown) {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function truncateUtf8(value: string, maxBytes: number) {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let result = '';
  for (const char of value) {
    if (Buffer.byteLength(result + char, 'utf8') > maxBytes) break;
    result += char;
  }
  return result.trimEnd();
}

function normalizePortableText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/]/g, ' - ')
    .replace(/[<>:"|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .trim();
}

function safeFileStem(job: ImportJob) {
  const metadata = job.metadataPreview?.effective;
  const title = normalizePortableText(metadata?.title ?? '') || 'Faixa importada';
  const artist = normalizePortableText(metadata?.artist ?? '');
  let stem = normalizePortableText(artist ? `${artist} - ${title}` : title) || 'Faixa importada';
  if (WINDOWS_RESERVED_NAMES.test(stem)) stem = `Faixa - ${stem}`;
  stem = truncateUtf8(stem, MAX_FILE_STEM_BYTES);
  return stem || 'Faixa importada';
}

function outputExtension(job: ImportJob) {
  const extension = job.mediaDecision?.output.extension?.trim().toLocaleLowerCase('en-US') ?? '';
  if (!SUPPORTED_OUTPUT_EXTENSIONS.has(extension)) {
    throw new ImportSafeDestinationError(
      'media_not_validated',
      'A validação técnica não definiu uma extensão de saída segura.',
      409
    );
  }
  return extension;
}

function validateFolderPart(value: string) {
  const part = value.normalize('NFKC').trim();
  if (
    !part
    || part === '.'
    || part === '..'
    || part.startsWith('.')
    || /[\u0000-\u001f\u007f]/.test(part)
    || PROBLEMATIC_PORTABLE_CHARS.test(part)
    || part.includes('\\')
    || WINDOWS_RESERVED_NAMES.test(part)
  ) {
    throw new ImportSafeDestinationError('invalid_destination', 'A pasta de destino contém um nome não permitido.');
  }
  if (Buffer.byteLength(part, 'utf8') > MAX_FOLDER_COMPONENT_BYTES) {
    throw new ImportSafeDestinationError('invalid_destination', 'A pasta de destino contém um componente longo demais.');
  }
  return part;
}

export function normalizeImportFolderPath(value: unknown) {
  if (value == null) return [DEFAULT_IMPORT_FOLDER];
  if (typeof value !== 'string') {
    throw new ImportSafeDestinationError('invalid_destination', 'Pasta de destino inválida.');
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized) return [] as string[];
  if (
    normalized.includes('\0')
    || normalized.includes('\\')
    || path.posix.isAbsolute(normalized)
    || Buffer.byteLength(normalized, 'utf8') > MAX_FOLDER_PATH_BYTES
  ) {
    throw new ImportSafeDestinationError('invalid_destination', 'Pasta de destino inválida.');
  }
  const parts = normalized.split('/').map(validateFolderPart);
  if (parts[0]?.toLocaleLowerCase('en-US') === '.home-music-trash') {
    throw new ImportSafeDestinationError('invalid_destination', 'A pasta interna da lixeira não pode ser usada como destino.');
  }
  return parts;
}

async function removeCreatedDirectories(created: string[]) {
  for (const directory of [...created].reverse()) {
    try {
      await rmdir(directory);
    } catch {
      // Mantém diretórios que receberam conteúdo ou mudaram externamente.
    }
  }
}

async function ensureSafeDirectory(root: string, parts: string[]) {
  let current = root;
  const created: string[] = [];
  try {
    for (const part of parts) {
      const candidate = path.join(current, part);
      try {
        const entry = await lstat(candidate);
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new ImportSafeDestinationError('invalid_destination', 'Diretório de destino inseguro.');
        }
      } catch (error) {
        if (!missing(error)) throw error;
        await mkdir(candidate, { mode: 0o750 });
        created.push(candidate);
      }
      const resolved = await realpath(candidate);
      if (!isPathInside(root, resolved)) {
        throw new ImportSafeDestinationError('invalid_destination', 'Diretório de destino escapou de MUSIC_DIR.');
      }
      current = resolved;
    }
    return { directory: current, created };
  } catch (error) {
    await removeCreatedDirectories(created);
    throw error;
  }
}

async function destinationExists(directory: string, fileName: string) {
  try {
    await lstat(path.join(directory, fileName));
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

function collisionFileName(stem: string, extension: string, collisionIndex: number) {
  return collisionIndex <= 1
    ? `${stem}${extension}`
    : `${stem} (${collisionIndex})${extension}`;
}

export class ImportSafeDestinationManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly validatedLookup: (jobId: string) => ValidatedImportPayload<unknown> | null;
  private readonly duplicateReady: (jobId: string) => boolean;
  private readonly musicDir: string;
  private promotionLock: Promise<void> = Promise.resolve();
  private readonly promoted = new Map<string, PromotedImportFile>();

  constructor(options: ImportSafeDestinationManagerOptions) {
    this.queue = options.queue;
    this.staging = options.staging;
    this.validatedLookup = options.validatedLookup;
    this.duplicateReady = options.duplicateReady;
    this.musicDir = options.musicDir ?? process.env.MUSIC_DIR ?? '';
  }

  getPromoted(jobId: string) {
    const promoted = this.promoted.get(jobId);
    return promoted ? { ...promoted } : null;
  }

  async plan(jobId: string, folderPath?: unknown): Promise<ImportDestinationPlan> {
    const job = this.requirePromotable(jobId);
    const parts = normalizeImportFolderPath(folderPath);
    const root = await this.libraryRoot();
    const { directory, created } = await ensureSafeDirectory(root, parts);
    try {
      return await this.planInside(job, directory, parts);
    } finally {
      await removeCreatedDirectories(created);
    }
  }

  async promote(jobId: string, folderPath?: unknown): Promise<ImportPromotionResult> {
    return this.withPromotionLock(async () => {
      const job = this.requirePromotable(jobId);
      const validated = this.validatedLookup(jobId)!;
      const parts = normalizeImportFolderPath(folderPath);
      const root = await this.libraryRoot();
      const { directory, created } = await ensureSafeDirectory(root, parts);
      let promotionStarted = false;
      try {
        const destination = await this.planInside(job, directory, parts);
        this.queue.transition(jobId, 'processing');
        promotionStarted = true;
        const promoted = await this.staging.promote(validated, destination.relativePath);
        this.promoted.set(jobId, promoted);
        const completed = this.queue.transition(jobId, 'completed')!;
        return { job: completed, destination };
      } catch (error) {
        if (promotionStarted) {
          const current = this.queue.get(jobId);
          if (current?.status === 'processing') {
            this.queue.transition(jobId, 'failed', 'Não foi possível promover a mídia para a biblioteca.');
          }
        }
        await removeCreatedDirectories(created);
        if (error instanceof ImportSafeDestinationError) throw error;
        throw new ImportSafeDestinationError(
          'promotion_failed',
          'Não foi possível promover a mídia para a biblioteca.',
          500
        );
      }
    });
  }

  private requirePromotable(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) throw new ImportSafeDestinationError('job_not_found', 'Job de importação não encontrado.', 404);
    if (job.status !== 'pending') {
      throw new ImportSafeDestinationError('job_not_ready', 'O job precisa estar pendente para definir o destino.', 409);
    }
    if (!job.mediaDecision || !this.validatedLookup(jobId)) {
      throw new ImportSafeDestinationError('media_not_validated', 'Valide tecnicamente a mídia antes de promover.', 409);
    }
    if (!job.metadataPreview) {
      throw new ImportSafeDestinationError('metadata_not_ready', 'Revise a metadata antes de promover.', 409);
    }
    if (!this.duplicateReady(jobId)) {
      throw new ImportSafeDestinationError(
        'duplicates_not_ready',
        'Conclua a verificação de duplicatas antes de promover.',
        409
      );
    }
    return job;
  }

  private async libraryRoot() {
    if (!this.musicDir.trim()) {
      throw new ImportSafeDestinationError('destination_unavailable', 'MUSIC_DIR não está configurado.', 409);
    }
    try {
      return await resolveLibraryRoot(this.musicDir);
    } catch {
      throw new ImportSafeDestinationError('destination_unavailable', 'A biblioteca não está disponível para promoção.', 503);
    }
  }

  private async planInside(job: ImportJob, directory: string, parts: string[]) {
    const stem = safeFileStem(job);
    const extension = outputExtension(job);
    for (let collisionIndex = 1; collisionIndex <= MAX_COLLISION_ATTEMPTS; collisionIndex += 1) {
      const fileName = collisionFileName(stem, extension, collisionIndex);
      if (await destinationExists(directory, fileName)) continue;
      const folderPath = parts.join('/');
      return {
        folderPath,
        fileName,
        relativePath: folderPath ? `${folderPath}/${fileName}` : fileName,
        collisionIndex
      };
    }
    throw new ImportSafeDestinationError(
      'destination_unavailable',
      'Não foi possível encontrar um nome livre no destino.',
      409
    );
  }

  private async withPromotionLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.promotionLock;
    let release!: () => void;
    this.promotionLock = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
