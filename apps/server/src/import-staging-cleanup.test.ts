import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DEFAULT_IMPORT_STAGING_TTL_HOURS,
  ImportStagingCleanupManager,
  parseImportStagingTtlHours
} from './import-staging-cleanup.js';
import { ImportStagingManager } from './import-staging.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-staging-cleanup-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  return {
    root,
    musicDir,
    stagingRoot,
    staging: new ImportStagingManager({ musicDir, stagingRoot }),
    cleanup: () => rm(root, { recursive: true, force: true })
  };
}

async function makeOld(candidatePath: string, nowMs: number, ageMs: number) {
  const timestamp = new Date(nowMs - ageMs);
  await utimes(candidatePath, timestamp, timestamp);
}

test('parseia TTL defensivo com limites explícitos', () => {
  assert.equal(parseImportStagingTtlHours(undefined), DEFAULT_IMPORT_STAGING_TTL_HOURS);
  assert.equal(parseImportStagingTtlHours(' 48 '), 48);
  for (const invalid of ['0', '-1', '1.5', 'abc', String(24 * 30 + 1)]) {
    assert.throws(() => parseImportStagingTtlHours(invalid), /HOME_MUSIC_IMPORT_STAGING_TTL_HOURS/);
  }
});

test('cleanup explícito de job é idempotente', async () => {
  const item = await fixture();
  try {
    const job = await item.staging.createJob('job-idempotente');
    await item.staging.writePayload(job.jobId, [Buffer.from('audio')]);
    assert.equal(await item.staging.cleanupJob(job.jobId), true);
    assert.equal(await item.staging.cleanupJob(job.jobId), false);
    await assert.rejects(() => lstat(job.workspacePath), { code: 'ENOENT' });
  } finally {
    await item.cleanup();
  }
});

test('varredura nunca remove workspace ativo mesmo quando TTL já venceu', async () => {
  const item = await fixture();
  const nowMs = Date.parse('2026-08-29T14:00:00.000Z');
  try {
    const job = await item.staging.createJob('job-ativo');
    await item.staging.writePayload(job.jobId, [Buffer.from('audio ativo')]);
    await makeOld(path.join(job.workspacePath, 'payload.bin'), nowMs, 48 * 60 * 60 * 1000);
    await makeOld(job.workspacePath, nowMs, 48 * 60 * 60 * 1000);

    const cleanup = new ImportStagingCleanupManager({
      staging: item.staging,
      ttlMs: 60 * 60 * 1000,
      now: () => nowMs
    });
    const summary = await cleanup.sweep();
    assert.equal(summary.skippedActive, 1);
    assert.equal(summary.removed, 0);
    assert.equal(item.staging.hasJob(job.jobId), true);
    assert.equal(await readFile(path.join(job.workspacePath, 'payload.bin'), 'utf8'), 'audio ativo');
  } finally {
    await item.cleanup();
  }
});

test('restart trata workspace antigo sem registro em memória como órfão e respeita TTL de arquivos internos', async () => {
  const item = await fixture();
  const nowMs = Date.parse('2026-08-29T14:00:00.000Z');
  try {
    const crashedJob = await item.staging.createJob('job-crash');
    await item.staging.writePayload(crashedJob.jobId, [Buffer.from('payload crash')]);
    await makeOld(path.join(crashedJob.workspacePath, 'payload.bin'), nowMs, 26 * 60 * 60 * 1000);
    await makeOld(crashedJob.workspacePath, nowMs, 26 * 60 * 60 * 1000);

    const freshOrphan = path.join(item.stagingRoot, 'job-fresh01');
    await mkdir(freshOrphan);
    await writeFile(path.join(freshOrphan, 'payload.bin'), 'recente');
    await makeOld(freshOrphan, nowMs, 30 * 60 * 60 * 1000);
    await makeOld(path.join(freshOrphan, 'payload.bin'), nowMs, 30 * 60 * 1000);

    const restartedStaging = new ImportStagingManager({
      musicDir: item.musicDir,
      stagingRoot: item.stagingRoot
    });
    const cleanup = new ImportStagingCleanupManager({
      staging: restartedStaging,
      ttlMs: 24 * 60 * 60 * 1000,
      now: () => nowMs
    });
    const summary = await cleanup.sweep('startup');

    assert.equal(summary.removed, 1);
    assert.equal(summary.skippedFresh, 1);
    await assert.rejects(() => lstat(crashedJob.workspacePath), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(freshOrphan, 'payload.bin'), 'utf8'), 'recente');
  } finally {
    await item.cleanup();
  }
});

test('cleanup parcial remove apenas entradas job-* e não segue symlink para fora do staging', async () => {
  const item = await fixture();
  const logs: Array<{ level: string; context: Record<string, unknown>; message: string }> = [];
  try {
    await item.staging.cleanupSnapshot();
    const orphan = path.join(item.stagingRoot, 'job-partial1');
    await mkdir(orphan);
    await writeFile(path.join(orphan, 'payload.bin'), 'parcial');
    await writeFile(path.join(orphan, 'transform.tmp'), 'resto');

    const outside = path.join(item.root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'preservar.txt'), 'intacto');
    const orphanLink = path.join(item.stagingRoot, 'job-link001');
    await symlink(outside, orphanLink);

    const foreign = path.join(item.stagingRoot, 'cache-manual');
    await mkdir(foreign);
    await writeFile(path.join(foreign, 'preservar.txt'), 'intacto');
    await writeFile(path.join(item.musicDir, 'biblioteca.flac'), 'música');

    const cleanup = new ImportStagingCleanupManager({
      staging: item.staging,
      ttlMs: 0,
      logger: {
        info: (context, message) => logs.push({ level: 'info', context, message }),
        warn: (context, message) => logs.push({ level: 'warn', context, message })
      }
    });
    const first = await cleanup.sweep();
    const second = await cleanup.sweep();

    assert.equal(first.removed, 2);
    assert.equal(first.ignored, 1);
    assert.equal(second.removed, 0);
    await assert.rejects(() => lstat(orphan), { code: 'ENOENT' });
    await assert.rejects(() => lstat(orphanLink), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(outside, 'preservar.txt'), 'utf8'), 'intacto');
    assert.equal(await readFile(path.join(foreign, 'preservar.txt'), 'utf8'), 'intacto');
    assert.equal(await readFile(path.join(item.musicDir, 'biblioteca.flac'), 'utf8'), 'música');
    assert.ok(logs.some(entry => entry.context.component === 'import-staging-cleanup' && entry.context.removed === 2));
  } finally {
    await item.cleanup();
  }
});

test('start executa varredura de startup e stop é idempotente', async () => {
  const item = await fixture();
  try {
    await item.staging.cleanupSnapshot();
    const orphan = path.join(item.stagingRoot, 'job-start01');
    await mkdir(orphan);
    const cleanup = new ImportStagingCleanupManager({
      staging: item.staging,
      ttlMs: 0,
      intervalMs: 60_000
    });
    const summary = await cleanup.start();
    assert.equal(summary.reason, 'startup');
    assert.equal(summary.removed, 1);
    cleanup.stop();
    cleanup.stop();
    await assert.rejects(() => lstat(orphan), { code: 'ENOENT' });
    assert.deepEqual((await readdir(item.stagingRoot)).filter(name => name.startsWith('job-')), []);
  } finally {
    await item.cleanup();
  }
});

test('falha no sweep de startup não desarma a tentativa periódica seguinte', async () => {
  const item = await fixture();
  try {
    await item.staging.cleanupSnapshot();
    let attempts = 0;
    const cleanup = new ImportStagingCleanupManager({
      staging: {
        cleanupSnapshot: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('filesystem temporariamente indisponível');
          return {
            stagingRoot: item.stagingRoot,
            musicRoot: item.musicDir,
            activeWorkspaces: []
          };
        }
      },
      ttlMs: 0,
      intervalMs: 10
    });

    await assert.rejects(() => cleanup.start(), /temporariamente indisponível/);
    await new Promise(resolve => setTimeout(resolve, 40));
    cleanup.stop();
    assert.ok(attempts >= 2);
  } finally {
    await item.cleanup();
  }
});
