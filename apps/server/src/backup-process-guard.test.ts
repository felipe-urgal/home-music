import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { databaseIsOpenByAnotherProcess } from './backup-process-guard.js';

async function waitForReady(child: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (!chunk.toString('utf8').includes('ready')) return;
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`Processo de teste encerrou antes de abrir o SQLite: ${code ?? 'signal'}`));
    };
    const cleanup = () => {
      child.stdout?.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

test('detecta outro processo com o SQLite aberto e libera após ele encerrar', async t => {
  if (process.platform !== 'linux') {
    t.skip('A guarda usa /proc e é específica do alvo Ubuntu/Linux.');
    return;
  }

  const dir = await mkdtemp(path.join(os.tmpdir(), 'home-music-backup-guard-'));
  const databasePath = path.join(dir, 'home-music.db');
  const setup = new DatabaseSync(databasePath);
  setup.exec('CREATE TABLE state(value TEXT);');
  setup.close();

  const script = `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.env.TEST_DATABASE_PATH);
    process.stdout.write('ready\\n');
    process.on('SIGTERM', () => { db.close(); process.exit(0); });
    setInterval(() => {}, 1000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TEST_DATABASE_PATH: databasePath },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForReady(child);
    assert.equal(await databaseIsOpenByAnotherProcess(databasePath), true);
    child.kill('SIGTERM');
    await once(child, 'exit');
    assert.equal(await databaseIsOpenByAnotherProcess(databasePath), false);
  } finally {
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
  }
});


test('Linux process guard never treats an unreadable /proc root as an empty process list', async t => {
  if (process.platform !== 'linux') {
    t.skip('/proc enumeration is Linux-specific');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-proc-unavailable-'));
  try {
    await assert.rejects(
      databaseIsOpenByAnotherProcess(path.join(root, 'home-music.db'), process.pid, path.join(root, 'missing-proc')),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Linux process guard detects database and WAL/SHM descriptors and excludes its own PID', async t => {
  if (process.platform !== 'linux') {
    t.skip('/proc enumeration is Linux-specific');
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-proc-fixture-'));
  try {
    const dbPath = path.join(root, 'home-music.db');
    const db = new DatabaseSync(dbPath);
    db.close();

    const procRoot = path.join(root, 'proc');
    const ownerPid = 97531;
    const fdDir = path.join(procRoot, String(ownerPid), 'fd');
    await mkdir(fdDir, { recursive: true });

    assert.equal(await databaseIsOpenByAnotherProcess(dbPath, process.pid, procRoot), false);
    for (const [index, target] of [
      dbPath, dbPath + '-wal', dbPath + '-shm', dbPath + ' (deleted)'
    ].entries()) {
      const descriptor = path.join(fdDir, String(index));
      await symlink(target, descriptor);
      assert.equal(await databaseIsOpenByAnotherProcess(dbPath, process.pid, procRoot), true);
      // The process holding the descriptor is ignored only when it is this process.
      assert.equal(await databaseIsOpenByAnotherProcess(dbPath, ownerPid, procRoot), false);
      await rm(descriptor);
    }
    assert.equal(await databaseIsOpenByAnotherProcess(dbPath, process.pid, procRoot), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
