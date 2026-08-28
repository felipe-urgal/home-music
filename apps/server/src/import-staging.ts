import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import path from 'node:path';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  stat,
  unlink,
  type FileHandle
} from 'node:fs/promises';
import { isPathInside, openRegularFileInside, resolveLibraryRoot } from './security.js';

const STAGING_DIRECTORY_MODE = 0o700;
const STAGING_FILE_MODE = 0o600;
const LIBRARY_FILE_MODE = 0o640;
const PAYLOAD_FILE_NAME = 'payload.bin';
const MAX_JOB_ID_LENGTH = 128;
const MAX_RELATIVE_PATH_BYTES = 2048;
const MAX_COMPONENT_BYTES = 255;

type ImportStagingState = 'created' | 'written' | 'validated';

type ImportStagingWorkspace = {
  jobId: string;
  directory: string;
  payloadPath: string;
  state: ImportStagingState;
  validationToken: string | null;
  validationSha256: string | null;
  validationSize: number | null;
};

export type ImportStagingJob = {
  jobId: string;
  workspacePath: string;
};

export type ImportValidationTarget = {
  path: string;
  size: number;
};

export type ValidatedImportPayload<T = unknown> = {
  jobId: string;
  token: string;
  size: number;
  sha256: string;
  validation: T;
};

export type PromotedImportFile = {
  absolutePath: string;
  relativePath: string;
  size: number;
  sha256: string;
};

export class ImportStagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportStagingError';
  }
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function normalizeJobId(jobId: string) {
  const value = typeof jobId === 'string' ? jobId.trim() : '';
  if (!value || value.length > MAX_JOB_ID_LENGTH) {
    throw new ImportStagingError('Identificador de importação inválido.');
  }
  return value;
}

function ensureDisjointRoots(stagingRoot: string, musicRoot: string) {
  if (isPathInside(musicRoot, stagingRoot) || isPathInside(stagingRoot, musicRoot)) {
    throw new ImportStagingError('O staging de importação deve ficar fora de MUSIC_DIR e não pode contê-lo.');
  }
}

async function projectedRealPath(candidatePath: string) {
  let current = path.resolve(candidatePath);
  const suffix: string[] = [];

  while (true) {
    try {
      const existing = await realpath(current);
      return path.join(existing, ...suffix);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

function normalizeRelativeDestination(value: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ImportStagingError('Destino final obrigatório.');
  }
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new ImportStagingError('Destino final inválido.');
  }

  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    throw new ImportStagingError('Destino final excede o limite de tamanho.');
  }

  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new ImportStagingError('Destino final inválido.');
  }

  for (const part of parts) {
    if (part.startsWith('.') || /[\u0000-\u001f\u007f]/.test(part)) {
      throw new ImportStagingError('Destino final contém componente não permitido.');
    }
    if (Buffer.byteLength(part, 'utf8') > MAX_COMPONENT_BYTES) {
      throw new ImportStagingError('Destino final contém componente longo demais.');
    }
  }

  return parts;
}

async function writeAll(handle: FileHandle, chunk: Uint8Array) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (bytesWritten <= 0) throw new ImportStagingError('Falha ao gravar arquivo no staging.');
    offset += bytesWritten;
  }
}

async function hashOpenHandle(handle: FileHandle) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;

  while (true) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }

  return { sha256: hash.digest('hex'), size: position };
}

async function resolveSafeDestination(musicRoot: string, relativeDestination: string) {
  const parts = normalizeRelativeDestination(relativeDestination);
  const fileName = parts.at(-1)!;
  let current = musicRoot;

  for (const component of parts.slice(0, -1)) {
    const candidate = path.join(current, component);
    const entry = await lstat(candidate).catch(error => {
      if (errorCode(error) === 'ENOENT') {
        throw new ImportStagingError('A pasta de destino ainda não existe na biblioteca.');
      }
      throw error;
    });
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new ImportStagingError('A pasta de destino não é segura.');
    }
    const resolved = await realpath(candidate);
    if (!isPathInside(musicRoot, resolved)) {
      throw new ImportStagingError('A pasta de destino escapou de MUSIC_DIR.');
    }
    current = resolved;
  }

  const destinationPath = path.join(current, fileName);
  if (!isPathInside(musicRoot, destinationPath)) {
    throw new ImportStagingError('Destino final fora de MUSIC_DIR.');
  }

  try {
    await lstat(destinationPath);
    throw new ImportStagingError('Já existe um arquivo no destino final.');
  } catch (error) {
    if (error instanceof ImportStagingError) throw error;
    if (errorCode(error) !== 'ENOENT') throw error;
  }

  return {
    destinationPath,
    parentPath: current,
    relativePath: parts.join('/')
  };
}

export class ImportStagingManager {
  private readonly stagingRootInput: string;
  private readonly musicDir: string;
  private readonly jobs = new Map<string, ImportStagingWorkspace>();
  private initializePromise: Promise<{ stagingRoot: string; musicRoot: string }> | null = null;

  constructor(options: { stagingRoot: string; musicDir: string }) {
    this.stagingRootInput = options.stagingRoot;
    this.musicDir = options.musicDir;
  }

  private initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeRoots().catch(error => {
        this.initializePromise = null;
        throw error;
      });
    }
    return this.initializePromise;
  }

  private async initializeRoots() {
    if (!this.musicDir.trim()) throw new ImportStagingError('MUSIC_DIR não está configurado.');
    if (!this.stagingRootInput.trim()) throw new ImportStagingError('Diretório de staging não está configurado.');

    const musicRoot = await resolveLibraryRoot(this.musicDir);
    const stagingCandidate = path.resolve(this.stagingRootInput);
    const projected = await projectedRealPath(stagingCandidate);
    ensureDisjointRoots(projected, musicRoot);

    try {
      const existing = await lstat(stagingCandidate);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new ImportStagingError('A raiz do staging deve ser um diretório real, sem symlink.');
      }
    } catch (error) {
      if (error instanceof ImportStagingError) throw error;
      if (errorCode(error) !== 'ENOENT') throw error;
      await mkdir(stagingCandidate, { recursive: true, mode: STAGING_DIRECTORY_MODE });
    }

    await chmod(stagingCandidate, STAGING_DIRECTORY_MODE);
    const stagingRoot = await realpath(stagingCandidate);
    ensureDisjointRoots(stagingRoot, musicRoot);
    return { stagingRoot, musicRoot };
  }

  async createJob(jobId: string): Promise<ImportStagingJob> {
    const normalizedJobId = normalizeJobId(jobId);
    if (this.jobs.has(normalizedJobId)) {
      throw new ImportStagingError('Este job já possui um staging ativo.');
    }

    const { stagingRoot } = await this.initialize();
    const directory = await mkdtemp(path.join(stagingRoot, 'job-'));
    await chmod(directory, STAGING_DIRECTORY_MODE);
    const resolvedDirectory = await realpath(directory);
    if (!isPathInside(stagingRoot, resolvedDirectory)) {
      await rm(directory, { recursive: true, force: true });
      throw new ImportStagingError('O workspace criado escapou da raiz de staging.');
    }

    const workspace: ImportStagingWorkspace = {
      jobId: normalizedJobId,
      directory: resolvedDirectory,
      payloadPath: path.join(resolvedDirectory, PAYLOAD_FILE_NAME),
      state: 'created',
      validationToken: null,
      validationSha256: null,
      validationSize: null
    };
    this.jobs.set(normalizedJobId, workspace);
    return { jobId: normalizedJobId, workspacePath: resolvedDirectory };
  }

  async writePayload(jobId: string, chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>) {
    const workspace = this.requireJob(jobId);
    if (workspace.state !== 'created') {
      throw new ImportStagingError('O payload deste job já foi gravado.');
    }

    let handle: FileHandle | null = null;
    try {
      handle = await open(
        workspace.payloadPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        STAGING_FILE_MODE
      );
      let size = 0;
      for await (const chunk of chunks) {
        if (!(chunk instanceof Uint8Array)) {
          throw new ImportStagingError('Chunk inválido recebido pelo staging.');
        }
        await writeAll(handle, chunk);
        size += chunk.byteLength;
      }
      await handle.sync();
      await handle.close();
      handle = null;
      await chmod(workspace.payloadPath, STAGING_FILE_MODE);
      workspace.state = 'written';
      return { size };
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await this.cleanupJob(workspace.jobId).catch(() => undefined);
      throw error;
    }
  }

  async validatePayload<T>(
    jobId: string,
    validator: (target: ImportValidationTarget) => Promise<T> | T
  ): Promise<ValidatedImportPayload<T>> {
    const workspace = this.requireJob(jobId);
    if (workspace.state !== 'written') {
      throw new ImportStagingError('O payload precisa estar gravado antes da validação.');
    }

    const { stagingRoot } = await this.initialize();
    try {
      const safeFile = await openRegularFileInside(stagingRoot, workspace.payloadPath);
      try {
        const before = await safeFile.handle.stat();
        const validation = await validator({
          path: `/proc/${process.pid}/fd/${safeFile.handle.fd}`,
          size: before.size
        });
        const after = await safeFile.handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
          throw new ImportStagingError('O payload mudou durante a validação.');
        }

        const digest = await hashOpenHandle(safeFile.handle);
        if (digest.size !== after.size) {
          throw new ImportStagingError('O payload mudou durante a validação.');
        }

        const token = randomUUID();
        workspace.state = 'validated';
        workspace.validationToken = token;
        workspace.validationSha256 = digest.sha256;
        workspace.validationSize = digest.size;
        return {
          jobId: workspace.jobId,
          token,
          size: digest.size,
          sha256: digest.sha256,
          validation
        };
      } finally {
        await safeFile.handle.close();
      }
    } catch (error) {
      await this.cleanupJob(workspace.jobId).catch(() => undefined);
      throw error;
    }
  }

  async promote<T>(validated: ValidatedImportPayload<T>, relativeDestination: string): Promise<PromotedImportFile> {
    const workspace = this.requireJob(validated.jobId);
    if (
      workspace.state !== 'validated'
      || !workspace.validationToken
      || workspace.validationToken !== validated.token
      || workspace.validationSha256 !== validated.sha256
      || workspace.validationSize !== validated.size
    ) {
      throw new ImportStagingError('Token de validação inválido ou obsoleto.');
    }

    const { stagingRoot, musicRoot } = await this.initialize();
    let destinationPath: string | null = null;
    let destinationCreated = false;

    try {
      const destination = await resolveSafeDestination(musicRoot, relativeDestination);
      destinationPath = destination.destinationPath;
      const safeFile = await openRegularFileInside(stagingRoot, workspace.payloadPath);
      try {
        const digest = await hashOpenHandle(safeFile.handle);
        if (digest.sha256 !== validated.sha256 || digest.size !== validated.size) {
          throw new ImportStagingError('O payload mudou depois da validação; promoção cancelada.');
        }

        const sourceStat = await safeFile.handle.stat();
        const parentStat = await stat(destination.parentPath);
        if (sourceStat.dev !== parentStat.dev) {
          throw new ImportStagingError('Staging e MUSIC_DIR estão em filesystems diferentes; promoção segura recusada.');
        }

        const sourceEntry = await lstat(workspace.payloadPath);
        if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink() || sourceEntry.dev !== sourceStat.dev || sourceEntry.ino !== sourceStat.ino) {
          throw new ImportStagingError('O payload mudou antes da promoção.');
        }

        try {
          await link(workspace.payloadPath, destination.destinationPath);
          destinationCreated = true;
        } catch (error) {
          if (errorCode(error) === 'EEXIST') {
            throw new ImportStagingError('Já existe um arquivo no destino final.');
          }
          if (errorCode(error) === 'EXDEV') {
            throw new ImportStagingError('Staging e MUSIC_DIR estão em filesystems diferentes; promoção segura recusada.');
          }
          throw error;
        }

        const promotedStat = await lstat(destination.destinationPath);
        if (!promotedStat.isFile() || promotedStat.isSymbolicLink() || promotedStat.dev !== sourceStat.dev || promotedStat.ino !== sourceStat.ino) {
          throw new ImportStagingError('Não foi possível confirmar a identidade do arquivo promovido.');
        }
        await chmod(destination.destinationPath, LIBRARY_FILE_MODE);
      } finally {
        await safeFile.handle.close();
      }

      await unlink(workspace.payloadPath);
      await rm(workspace.directory, { recursive: true, force: true });
      this.jobs.delete(workspace.jobId);
      return {
        absolutePath: destination.destinationPath,
        relativePath: destination.relativePath,
        size: validated.size,
        sha256: validated.sha256
      };
    } catch (error) {
      if (destinationCreated && destinationPath) {
        await unlink(destinationPath).catch(() => undefined);
      }
      await this.cleanupJob(workspace.jobId).catch(() => undefined);
      throw error;
    }
  }

  async cleanupJob(jobId: string) {
    const normalizedJobId = normalizeJobId(jobId);
    const workspace = this.jobs.get(normalizedJobId);
    if (!workspace) return false;

    const { stagingRoot } = await this.initialize();
    if (!isPathInside(stagingRoot, workspace.directory)) {
      throw new ImportStagingError('Workspace fora da raiz de staging; limpeza recusada.');
    }

    try {
      const entry = await lstat(workspace.directory);
      if (entry.isSymbolicLink()) await unlink(workspace.directory);
      else await rm(workspace.directory, { recursive: true, force: true });
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
    }
    this.jobs.delete(normalizedJobId);
    return true;
  }

  hasJob(jobId: string) {
    return this.jobs.has(normalizeJobId(jobId));
  }

  private requireJob(jobId: string) {
    const normalizedJobId = normalizeJobId(jobId);
    const workspace = this.jobs.get(normalizedJobId);
    if (!workspace) throw new ImportStagingError('Staging não encontrado para este job.');
    return workspace;
  }
}
