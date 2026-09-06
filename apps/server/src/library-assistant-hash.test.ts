import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM,
  LIBRARY_ASSISTANT_CONTENT_HASH_VERSION
} from '@home-music/shared/library-assistant';
import {
  hashLibraryAssistantFile,
  LibraryAssistantHashAbortedError
} from './library-assistant-hash.js';

async function withTempDir(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-assistant-hash-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('hashLibraryAssistantFile returns a deterministic versioned sha256 identity', async () => {
  await withTempDir(async directory => {
    const filePath = path.join(directory, 'track.bin');
    const content = Buffer.from('home-music-content-identity');
    await writeFile(filePath, content);

    const first = await hashLibraryAssistantFile(filePath);
    const second = await hashLibraryAssistantFile(filePath);

    assert.deepEqual(first.identity, second.identity);
    assert.equal(first.identity.algorithm, LIBRARY_ASSISTANT_CONTENT_HASH_ALGORITHM);
    assert.equal(first.identity.version, LIBRARY_ASSISTANT_CONTENT_HASH_VERSION);
    assert.equal(first.identity.sizeBytes, content.length);
    assert.equal(first.identity.digest, createHash('sha256').update(content).digest('hex'));
    assert.match(first.identity.digest, /^[a-f0-9]{64}$/);
    assert.equal(first.evidence.sizeBytes, content.length);
    assert.ok(Number.isFinite(first.evidence.mtimeMs));
  });
});

test('hashLibraryAssistantFile streams files larger than its read buffer', async () => {
  await withTempDir(async directory => {
    const filePath = path.join(directory, 'large-track.bin');
    const content = Buffer.alloc(2 * 1024 * 1024 + 17, 0x5a);
    await writeFile(filePath, content);

    const result = await hashLibraryAssistantFile(filePath);

    assert.equal(result.identity.sizeBytes, content.length);
    assert.equal(result.identity.digest, createHash('sha256').update(content).digest('hex'));
  });
});

test('hashLibraryAssistantFile rejects non-regular files', async () => {
  await withTempDir(async directory => {
    const nested = path.join(directory, 'folder');
    await mkdir(nested);

    await assert.rejects(
      () => hashLibraryAssistantFile(nested),
      /arquivo regular/
    );
  });
});

test('hashLibraryAssistantFile fails fast when already cancelled', async () => {
  await withTempDir(async directory => {
    const filePath = path.join(directory, 'track.bin');
    await writeFile(filePath, 'cancelled');
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => hashLibraryAssistantFile(filePath, controller.signal),
      LibraryAssistantHashAbortedError
    );
  });
});
