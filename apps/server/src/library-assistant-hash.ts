import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM,
  LIBRARY_ASSISTANT_CONTENT_HASH_VERSION,
  type LibraryAssistantContentIdentity
} from '@home-music/shared/library-assistant';

const HASH_STREAM_HIGH_WATER_MARK = 64 * 1024;

export class LibraryAssistantHashAbortedError extends Error {
  constructor() {
    super('Cálculo da identidade por conteúdo cancelado.');
    this.name = 'LibraryAssistantHashAbortedError';
  }
}

export class LibraryAssistantFileChangedError extends Error {
  constructor() {
    super('Arquivo alterado durante o cálculo da identidade por conteúdo.');
    this.name = 'LibraryAssistantFileChangedError';
  }
}

export type LibraryAssistantFileEvidence = {
  sizeBytes: number;
  mtimeMs: number;
};

export type LibraryAssistantHashedFile = {
  identity: LibraryAssistantContentIdentity;
  evidence: LibraryAssistantFileEvidence;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new LibraryAssistantHashAbortedError();
}

function sameEvidence(
  before: LibraryAssistantFileEvidence,
  after: LibraryAssistantFileEvidence
) {
  return before.sizeBytes === after.sizeBytes && before.mtimeMs === after.mtimeMs;
}

async function readEvidence(filePath: string): Promise<LibraryAssistantFileEvidence> {
  const info = await stat(filePath);
  if (!info.isFile()) throw new TypeError('Identidade por conteúdo exige um arquivo regular.');
  return {
    sizeBytes: info.size,
    mtimeMs: info.mtimeMs
  };
}

export async function hashLibraryAssistantFile(
  filePath: string,
  signal?: AbortSignal
): Promise<LibraryAssistantHashedFile> {
  throwIfAborted(signal);
  const before = await readEvidence(filePath);
  throwIfAborted(signal);

  const hash = createHash(LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM);
  try {
    for await (const chunk of createReadStream(filePath, {
      highWaterMark: HASH_STREAM_HIGH_WATER_MARK,
      signal
    })) {
      throwIfAborted(signal);
      hash.update(chunk);
    }
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new LibraryAssistantHashAbortedError();
    }
    throw error;
  }

  throwIfAborted(signal);
  const after = await readEvidence(filePath);
  if (!sameEvidence(before, after)) throw new LibraryAssistantFileChangedError();

  return {
    identity: {
      algorithm: LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM,
      version: LIBRARY_ASSISTANT_CONTENT_HASH_VERSION,
      digest: hash.digest('hex'),
      sizeBytes: before.sizeBytes
    },
    evidence: before
  };
}
