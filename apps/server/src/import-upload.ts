import path from 'node:path';
import type { Readable } from 'node:stream';
import type { ImportJob } from '@home-music/shared';
import type { ImportJobQueue } from './import-job-queue.js';
import type { ImportStagingManager } from './import-staging.js';

export const IMPORT_UPLOAD_EXTENSIONS = [
  '.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'
] as const;
export const DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES = 512;
const MAX_IMPORT_UPLOAD_MEGABYTES = 8192;
const MAX_FILE_NAME_BYTES = 512;

export type ImportUploadConfig = {
  maxBytes: number;
  acceptedExtensions: string[];
};

export type ImportUploadStart = {
  job: ImportJob;
};

export type ImportUploadResult = {
  job: ImportJob;
  receivedBytes: number;
};

type UploadSession = {
  jobId: string;
  fileName: string;
  declaredSize: number;
  received: boolean;
  receiving: boolean;
  cancelRequested: boolean;
  stream: Readable | null;
  settled: Promise<void> | null;
  resolveSettled: (() => void) | null;
};

export class ImportUploadError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'ImportUploadError';
    this.statusCode = statusCode;
  }
}

class ImportUploadCancelledError extends Error {
  constructor() {
    super('Upload cancelado.');
    this.name = 'ImportUploadCancelledError';
  }
}

export function parseImportUploadMaxMegabytes(value: string | undefined) {
  if (value == null || value.trim() === '') return DEFAULT_IMPORT_UPLOAD_MAX_MEGABYTES;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_IMPORT_UPLOAD_MEGABYTES) {
    throw new ImportUploadError(
      `HOME_MUSIC_IMPORT_UPLOAD_MAX_MB deve ser um inteiro entre 1 e ${MAX_IMPORT_UPLOAD_MEGABYTES}.`
    );
  }
  return parsed;
}

function cleanFileName(value: unknown) {
  if (typeof value !== 'string') throw new ImportUploadError('Nome do arquivo obrigatório.');
  const fileName = value.trim();
  if (
    !fileName
    || fileName === '.'
    || fileName === '..'
    || fileName.includes('/')
    || fileName.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(fileName)
    || Buffer.byteLength(fileName, 'utf8') > MAX_FILE_NAME_BYTES
  ) {
    throw new ImportUploadError('Nome do arquivo inválido.');
  }

  const extension = path.extname(fileName).toLowerCase();
  if (!(IMPORT_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new ImportUploadError(
      `Formato não suportado. Use ${IMPORT_UPLOAD_EXTENSIONS.join(', ')}.`
    );
  }
  return fileName;
}

function cleanDeclaredSize(value: unknown, maxBytes: number) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ImportUploadError('Tamanho do arquivo inválido.');
  }
  if (value > maxBytes) {
    throw new ImportUploadError('O arquivo excede o limite configurado para upload.', 413);
  }
  return value;
}

export class ImportUploadManager {
  private readonly queue: ImportJobQueue;
  private readonly staging: ImportStagingManager;
  private readonly maxBytes: number;
  private readonly sessions = new Map<string, UploadSession>();

  constructor(options: {
    queue: ImportJobQueue;
    staging: ImportStagingManager;
    maxBytes: number;
  }) {
    this.queue = options.queue;
    this.staging = options.staging;
    this.maxBytes = options.maxBytes;
  }

  get config(): ImportUploadConfig {
    return {
      maxBytes: this.maxBytes,
      acceptedExtensions: [...IMPORT_UPLOAD_EXTENSIONS]
    };
  }

  async start(fileNameInput: unknown, sizeInput: unknown): Promise<ImportUploadStart> {
    const fileName = cleanFileName(fileNameInput);
    const declaredSize = cleanDeclaredSize(sizeInput, this.maxBytes);
    const job = this.queue.enqueue({ type: 'upload', provider: null }, fileName);

    try {
      await this.staging.createJob(job.id);
      this.sessions.set(job.id, {
        jobId: job.id,
        fileName,
        declaredSize,
        received: false,
        receiving: false,
        cancelRequested: false,
        stream: null,
        settled: null,
        resolveSettled: null
      });
      return { job };
    } catch (error) {
      this.queue.transition(job.id, 'failed', 'Não foi possível preparar o staging do upload.');
      throw error;
    }
  }

  async receive(jobId: string, stream: Readable, contentLength?: number): Promise<ImportUploadResult> {
    const session = this.requireSession(jobId);
    const job = this.queue.get(jobId);
    if (!job || job.status !== 'pending') {
      throw new ImportUploadError('Este upload não está mais disponível para receber dados.', 409);
    }
    if (session.received || session.receiving) {
      throw new ImportUploadError('Os dados deste upload já foram enviados ou estão em envio.', 409);
    }
    if (contentLength != null && contentLength !== session.declaredSize) {
      await this.failBeforeReceive(session, 'O tamanho recebido não corresponde ao arquivo selecionado.');
      throw new ImportUploadError('O tamanho recebido não corresponde ao arquivo selecionado.');
    }

    session.receiving = true;
    session.stream = stream;
    session.settled = new Promise<void>(resolve => {
      session.resolveSettled = resolve;
    });

    let receivedBytes = 0;
    try {
      await this.staging.writePayload(jobId, this.limitChunks(session, stream, value => {
        receivedBytes = value;
      }));

      if (session.cancelRequested) throw new ImportUploadCancelledError();
      if (receivedBytes !== session.declaredSize) {
        throw new ImportUploadError('O upload terminou com tamanho diferente do arquivo selecionado.');
      }

      session.received = true;
      const current = this.queue.get(jobId);
      if (!current) throw new ImportUploadError('Job de importação não encontrado.', 404);
      return { job: current, receivedBytes };
    } catch (error) {
      await this.staging.cleanupJob(jobId).catch(() => undefined);
      const current = this.queue.get(jobId);
      if (current?.status === 'pending') {
        if (session.cancelRequested || error instanceof ImportUploadCancelledError) {
          this.queue.transition(jobId, 'cancelled');
        } else {
          const message = error instanceof ImportUploadError
            ? error.message
            : 'Falha durante o recebimento do arquivo.';
          this.queue.transition(jobId, 'failed', message);
        }
      }
      this.sessions.delete(jobId);
      throw error;
    } finally {
      session.receiving = false;
      session.stream = null;
      session.resolveSettled?.();
      session.resolveSettled = null;
    }
  }

  async cancel(jobId: string) {
    const session = this.sessions.get(jobId);
    const job = this.queue.get(jobId);
    if (!job) throw new ImportUploadError('Job de importação não encontrado.', 404);
    if (job.source.type !== 'upload') {
      throw new ImportUploadError('Este job não pertence a um upload local.', 409);
    }
    if (job.status !== 'pending') {
      throw new ImportUploadError('Este job não pode mais ser cancelado.', 409);
    }

    if (!session) {
      this.queue.transition(jobId, 'cancelled');
      return this.queue.get(jobId)!;
    }

    session.cancelRequested = true;
    if (session.receiving) {
      session.stream?.destroy(new ImportUploadCancelledError());
      await session.settled?.catch(() => undefined);
    } else {
      await this.staging.cleanupJob(jobId);
      if (this.queue.get(jobId)?.status === 'pending') this.queue.transition(jobId, 'cancelled');
      this.sessions.delete(jobId);
    }

    return this.queue.get(jobId)!;
  }

  private async *limitChunks(
    session: UploadSession,
    stream: Readable,
    onBytes: (receivedBytes: number) => void
  ): AsyncGenerator<Uint8Array> {
    let receivedBytes = 0;
    for await (const chunk of stream) {
      if (session.cancelRequested) throw new ImportUploadCancelledError();
      const bytes = chunk instanceof Uint8Array ? chunk : Buffer.from(chunk);
      receivedBytes += bytes.byteLength;
      if (receivedBytes > this.maxBytes || receivedBytes > session.declaredSize) {
        throw new ImportUploadError('O arquivo excede o tamanho declarado ou o limite de upload.', 413);
      }
      onBytes(receivedBytes);
      yield bytes;
    }
    if (session.cancelRequested) throw new ImportUploadCancelledError();
  }

  private async failBeforeReceive(session: UploadSession, message: string) {
    await this.staging.cleanupJob(session.jobId).catch(() => undefined);
    if (this.queue.get(session.jobId)?.status === 'pending') {
      this.queue.transition(session.jobId, 'failed', message);
    }
    this.sessions.delete(session.jobId);
  }

  private requireSession(jobId: string) {
    const session = this.sessions.get(jobId);
    if (!session) throw new ImportUploadError('Upload não encontrado ou já encerrado.', 404);
    return session;
  }
}
