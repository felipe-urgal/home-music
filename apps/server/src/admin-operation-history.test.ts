import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ImportJob } from '@home-music/shared';
import {
  AdminOperationHistoryStore,
  sanitizeOperationError,
  sanitizeOperationLabel
} from './admin-operation-history.js';

function tempDatabase() {
  return mkdtemp(path.join(os.tmpdir(), 'home-music-operation-history-'));
}

function importJob(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    source: { type: 'url', provider: null },
    label: 'https://example.test/audio.flac?token=segredo',
    status: 'pending',
    createdAt: '2026-08-28T12:01:00.000Z',
    updatedAt: '2026-08-28T12:01:00.000Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    mediaDecision: null,
    ...overrides
  };
}

test('persiste scans/importações concluídos com contagens, duração e filtros após reabrir o store', async () => {
  const dir = await tempDatabase();
  const databasePath = path.join(dir, 'home-music.db');
  const timestamps = [
    '2026-08-28T12:00:00.000Z',
    '2026-08-28T12:00:03.250Z'
  ];
  let time = 0;
  try {
    const store = new AdminOperationHistoryStore(databasePath, {
      createId: () => 'scan-1',
      now: () => new Date(timestamps[Math.min(time++, timestamps.length - 1)])
    });
    const id = store.startScan('manual');
    store.completeScan(id, {
      tracks: 42,
      scannedAt: '2026-08-28T12:00:03.000Z',
      added: 2,
      updated: 3,
      removed: 1,
      unchanged: 36
    });
    store.recordImport(importJob({
      status: 'completed',
      startedAt: '2026-08-28T12:01:01.000Z',
      finishedAt: '2026-08-28T12:01:04.000Z',
      updatedAt: '2026-08-28T12:01:04.000Z'
    }));
    store.close();

    const reopened = new AdminOperationHistoryStore(databasePath);
    const scans = reopened.list({ kind: 'scan', status: 'completed' });
    assert.equal(scans.length, 1);
    assert.equal(scans[0].label, 'Scan manual');
    assert.equal(scans[0].scanTrigger, 'manual');
    assert.equal(scans[0].durationMs, 3_250);
    assert.deepEqual(scans[0].counts, {
      tracks: 42,
      added: 2,
      updated: 3,
      removed: 1,
      unchanged: 36
    });

    const imports = reopened.list({ kind: 'import', status: 'completed' });
    assert.equal(imports.length, 1);
    assert.equal(imports[0].label, 'Importação por URL');
    assert.equal(imports[0].durationMs, 3_000);
    assert.deepEqual(imports[0].counts, {
      tracks: null,
      added: null,
      updated: null,
      removed: null,
      unchanged: null
    });
    assert.deepEqual(imports[0].importSource, { type: 'url', provider: null });
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('normaliza labels e erros antes de persistir ou devolver para a UI', async () => {
  assert.equal(sanitizeOperationLabel('  Scan   completo  '), 'Scan completo');
  assert.equal(sanitizeOperationLabel('https://example.test/audio.flac?token=segredo'), 'Importação por URL');
  assert.equal(sanitizeOperationLabel('Provider · youtube'), 'Provider · youtube');
  assert.equal(
    sanitizeOperationError('Falhou em /home/felipe/Music/faixa.flac com token=segredo'),
    'Falha durante a operação.'
  );

  const dir = await tempDatabase();
  const databasePath = path.join(dir, 'home-music.db');
  try {
    const store = new AdminOperationHistoryStore(databasePath, { createId: () => 'import-1' });
    store.recordImport(importJob({
      status: 'failed',
      error: 'erro interno /etc/passwd token=segredo',
      finishedAt: '2026-08-28T12:01:04.000Z'
    }));
    const failed = store.list({ kind: 'import', status: 'failed' });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].error?.message, 'Falha durante a importação.');
    assert.equal(failed[0].error?.action, 'Revise a origem e tente novamente.');
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('limita quantidade retornada e ordena operações mais recentes primeiro', async () => {
  const dir = await tempDatabase();
  const databasePath = path.join(dir, 'home-music.db');
  try {
    const store = new AdminOperationHistoryStore(databasePath);
    for (let index = 0; index < 7; index += 1) {
      store.recordImport(importJob({
        id: `job-${index}`,
        createdAt: `2026-08-28T12:0${index}:00.000Z`,
        updatedAt: `2026-08-28T12:0${index}:00.000Z`
      }));
    }
    const limited = store.list({ limit: 3 });
    assert.equal(limited.length, 3);
    assert.deepEqual(limited.map(item => item.id), ['job-6', 'job-5', 'job-4']);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
