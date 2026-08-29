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
    metadataPreview: null,
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
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('restart encerra operações pendentes/em andamento como interrompidas', async () => {
  const dir = await tempDatabase();
  const databasePath = path.join(dir, 'home-music.db');
  try {
    const store = new AdminOperationHistoryStore(databasePath, {
      createId: () => 'interrompido',
      now: () => new Date('2026-08-28T12:00:00.000Z')
    });
    store.startScan('automatic');
    store.recordImport(importJob({ id: 'interrompido' }));
    store.close();

    const reopened = new AdminOperationHistoryStore(databasePath, {
      now: () => new Date('2026-08-28T12:10:00.000Z')
    });
    const interrupted = reopened.list({ status: 'cancelled' });
    assert.equal(interrupted.length, 2);
    for (const item of interrupted) {
      assert.equal(item.finishedAt, '2026-08-28T12:10:00.000Z');
      assert.match(item.error?.message ?? '', /interrompida pelo reinício/i);
      assert.match(item.error?.action ?? '', /inicie a operação novamente/i);
      assert.equal(item.canRetry, false);
    }
    reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('upsert de importação acompanha a fila e sanitiza erro sensível', async () => {
  const dir = await tempDatabase();
  const databasePath = path.join(dir, 'home-music.db');
  try {
    const store = new AdminOperationHistoryStore(databasePath);
    store.recordImport(importJob());
    store.recordImport(importJob({
      status: 'processing',
      startedAt: '2026-08-28T12:01:02.000Z',
      updatedAt: '2026-08-28T12:01:02.000Z'
    }));
    store.recordImport(importJob({
      status: 'failed',
      startedAt: '2026-08-28T12:01:02.000Z',
      finishedAt: '2026-08-28T12:01:05.000Z',
      updatedAt: '2026-08-28T12:01:05.000Z',
      error: 'Falhou em /srv/music/privado.flac token=abc123 Bearer supersecreto https://host.test/a?secret=xyz'
    }));

    const [item] = store.list({ kind: 'import' });
    assert.equal(item.status, 'failed');
    assert.equal(item.durationMs, 3_000);
    assert.equal(item.canRetry, false);
    assert.ok(item.error);
    assert.doesNotMatch(item.error!.message, /srv\/music|abc123|supersecreto|host\.test|xyz/i);
    assert.match(item.error!.message, /\[caminho removido\]|\[redigido\]|\[URL removida\]/);
    assert.match(item.error!.action, /tente novamente|logs/i);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sanitização classifica erros conhecidos sem expor detalhes brutos', () => {
  const permissionError = Object.assign(new Error('permission denied /home/user/Music/faixa.flac'), { code: 'EACCES' });
  const sanitized = sanitizeOperationError(permissionError);
  assert.match(sanitized.message, /permissão/i);
  assert.doesNotMatch(sanitized.message, /home\/user|faixa\.flac/i);
  assert.match(sanitized.action, /permissões/i);

  assert.equal(
    sanitizeOperationLabel('https://example.test/media?token=segredo', 'Importação por URL'),
    'Importação por URL'
  );
});

test('retenção remove terminais antigos sem podar operação pendente', async () => {
  const dir = await tempDatabase();
  const databasePath = path.join(dir, 'home-music.db');
  let sequence = 0;
  let clock = 0;
  try {
    const store = new AdminOperationHistoryStore(databasePath, {
      maxRetainedOperations: 2,
      createId: () => `id-${++sequence}`,
      now: () => new Date(`2026-08-28T12:00:${String(clock++).padStart(2, '0')}.000Z`)
    });
    store.recordImport(importJob({ id: 'pending', source: { type: 'upload', provider: null }, label: 'Upload novo' }));

    for (let index = 0; index < 3; index += 1) {
      const id = store.startScan('automatic');
      store.completeScan(id, {
        tracks: index,
        scannedAt: '2026-08-28T12:00:00.000Z',
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: index
      });
    }

    const items = store.list();
    assert.equal(items.filter(item => item.status === 'completed').length, 2);
    assert.equal(items.some(item => item.id === 'import-pending' && item.status === 'pending'), true);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
