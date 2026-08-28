import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
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
