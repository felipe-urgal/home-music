import { chmod, lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { isPathInside, openRegularFileInside, resolveLibraryRoot } from './security.js';

const SCRATCH_DIRECTORY_MODE = 0o700;
const MAX_JOB_ID_LENGTH = 128;
const MAX_RELATIVE_PATH_BYTES = 2048;
const MAX_COMPONENT_BYTES = 255;

type ScratchWorkspace = {
  jobId: string;
  directory: string;
};

export type ExternalProviderScratchJob = {
  jobId: string;
  workspacePath: string;
};

export class ExternalProviderScratchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalProviderScratchError';
  }
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

function normalizeJobId(jobId: string) {
  const value = typeof jobId === 'string' ? jobId.trim() : '';
  if (!value || value.length > MAX_JOB_ID_LENGTH) {
    throw new ExternalProviderScratchError('Identificador de provider inválido.');
  }
  return value;
}

function ensureDisjointRoots(scratchRoot: string, musicRoot: string) {
  if (isPathInside(musicRoot, scratchRoot) || isPathInside(scratchRoot, musicRoot)) {
    throw new ExternalProviderScratchError('O scratch de providers deve ficar fora de MUSIC_DIR e não pode contê-lo.');
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

function normalizeRelativeOutput(value: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExternalProviderScratchError('Arquivo de saída do provider é obrigatório.');
  }
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new ExternalProviderScratchError('Caminho de saída do provider inválido.');
  }

  const normalized = value.trim();
  if (Buffer.byteLength(normalized, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    throw new ExternalProviderScratchError('Caminho de saída do provider excede o limite de tamanho.');
  }

  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new ExternalProviderScratchError('Caminho de saída do provider inválido.');
  }
  for (const part of parts) {
    if (/[\u0000-\u001f\u007f]/.test(part) || Buffer.byteLength(part, 'utf8') > MAX_COMPONENT_BYTES) {
      throw new ExternalProviderScratchError('Caminho de saída do provider contém componente não permitido.');
    }
  }
  return parts;
}

export class ExternalProviderScratchManager {
  private readonly scratchRootInput: string;
  private readonly musicDir: string;
  private readonly jobs = new Map<string, ScratchWorkspace>();
  private initializePromise: Promise<{ scratchRoot: string; musicRoot: string }> | null = null;

  constructor(options: { scratchRoot: string; musicDir: string }) {
    this.scratchRootInput = options.scratchRoot;
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
    if (!this.musicDir.trim()) throw new ExternalProviderScratchError('MUSIC_DIR não está configurado.');
    if (!this.scratchRootInput.trim()) throw new ExternalProviderScratchError('Diretório de scratch não está configurado.');

    const musicRoot = await resolveLibraryRoot(this.musicDir);
    const scratchCandidate = path.resolve(this.scratchRootInput);
    const projected = await projectedRealPath(scratchCandidate);
    ensureDisjointRoots(projected, musicRoot);

    try {
      const existing = await lstat(scratchCandidate);
      if (existing.isSymbolicLink() || !existing.isDirectory()) {
        throw new ExternalProviderScratchError('A raiz do scratch deve ser um diretório real, sem symlink.');
      }
    } catch (error) {
      if (error instanceof ExternalProviderScratchError) throw error;
      if (errorCode(error) !== 'ENOENT') throw error;
      await mkdir(scratchCandidate, { recursive: true, mode: SCRATCH_DIRECTORY_MODE });
    }

    await chmod(scratchCandidate, SCRATCH_DIRECTORY_MODE);
    const scratchRoot = await realpath(scratchCandidate);
    ensureDisjointRoots(scratchRoot, musicRoot);
    return { scratchRoot, musicRoot };
  }

  async createJob(jobId: string): Promise<ExternalProviderScratchJob> {
    const normalizedJobId = normalizeJobId(jobId);
    if (this.jobs.has(normalizedJobId)) {
      throw new ExternalProviderScratchError('Este job já possui um scratch ativo.');
    }

    const { scratchRoot } = await this.initialize();
    const directory = await mkdtemp(path.join(scratchRoot, 'provider-'));
    await chmod(directory, SCRATCH_DIRECTORY_MODE);
    const resolvedDirectory = await realpath(directory);
    if (!isPathInside(scratchRoot, resolvedDirectory)) {
      await rm(directory, { recursive: true, force: true });
      throw new ExternalProviderScratchError('O scratch criado escapou da raiz permitida.');
    }

    this.jobs.set(normalizedJobId, { jobId: normalizedJobId, directory: resolvedDirectory });
    return { jobId: normalizedJobId, workspacePath: resolvedDirectory };
  }

  async openOutput(jobId: string, relativePath: string) {
    const workspace = this.requireJob(jobId);
    const parts = normalizeRelativeOutput(relativePath);
    const candidate = path.join(workspace.directory, ...parts);
    if (!isPathInside(workspace.directory, candidate)) {
      throw new ExternalProviderScratchError('O arquivo retornado pelo provider escapou do scratch.');
    }

    try {
      return await openRegularFileInside(workspace.directory, candidate);
    } catch {
      throw new ExternalProviderScratchError('O provider não retornou um arquivo regular seguro.');
    }
  }

  async cleanupJob(jobId: string) {
    const normalizedJobId = normalizeJobId(jobId);
    const workspace = this.jobs.get(normalizedJobId);
    if (!workspace) return false;

    const { scratchRoot } = await this.initialize();
    if (!isPathInside(scratchRoot, workspace.directory)) {
      throw new ExternalProviderScratchError('Scratch fora da raiz permitida; limpeza recusada.');
    }

    try {
      const entry = await lstat(workspace.directory);
      if (entry.isSymbolicLink()) throw new ExternalProviderScratchError('Scratch inesperadamente virou symlink.');
      await rm(workspace.directory, { recursive: true, force: true });
    } catch (error) {
      if (error instanceof ExternalProviderScratchError) throw error;
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
    if (!workspace) throw new ExternalProviderScratchError('Scratch não encontrado para este job.');
    return workspace;
  }
}
