import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import Fastify from 'fastify';
import { AccountPasswordService } from './account-password.js';
import { AdminOperationHistoryStore } from './admin-operation-history.js';
import { AdminUsersService } from './admin-users.js';
import { HomeMusicDatabase } from './database.js';
import { OpenSubsonicCredentialStore } from './open-subsonic-credentials.js';
import { PersistentSessionManager } from './persistent-session-manager.js';
import { createServerInfrastructure } from './server-infrastructure.js';
import { TrackAvailabilityStore } from './track-availability-store.js';
import { UserAuthStore } from './user-auth-store.js';

const storeTypes = [
  { name: 'database', prototype: HomeMusicDatabase.prototype },
  { name: 'trackAvailability', prototype: TrackAvailabilityStore.prototype },
  { name: 'authUsers', prototype: UserAuthStore.prototype },
  { name: 'openSubsonicCredentials', prototype: OpenSubsonicCredentialStore.prototype },
  { name: 'sessions', prototype: PersistentSessionManager.prototype },
  { name: 'accountPasswords', prototype: AccountPasswordService.prototype },
  { name: 'adminUsers', prototype: AdminUsersService.prototype },
  { name: 'operationHistory', prototype: AdminOperationHistoryStore.prototype }
] as const;

const expectedCloseOrder = storeTypes.map(item => item.name).reverse();

function watchCloses(t: TestContext, failName?: string) {
  const closed: string[] = [];
  for (const { name, prototype } of storeTypes) {
    const original = prototype.close as (this: object) => void;
    t.mock.method(prototype, 'close', function (this: object) {
      closed.push(name);
      original.call(this);
      if (name === failName) throw new Error('injected close failure');
    });
  }
  return closed;
}

async function withInfrastructure(
  run: (options: Parameters<typeof createServerInfrastructure>[0]) => Promise<void> | void
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-infrastructure-lifecycle-'));
  const app = Fastify({ logger: false });
  try {
    await run({
      databasePath: path.join(directory, 'home-music.db'),
      transcodeCachePath: path.join(directory, 'transcode-cache'),
      ffmpegCommand: 'ffmpeg',
      transcodeCacheMegabytes: 64,
      logger: app.log
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test('shutdown closes each owned SQLite store once in reverse startup order', async t => {
  await withInfrastructure(options => {
    const closed = watchCloses(t);
    const infrastructure = createServerInfrastructure(options);
    assert.equal(infrastructure.database.getSchemaVersion() > 0, true);
    infrastructure.close();
    infrastructure.close();
    assert.deepEqual(closed, expectedCloseOrder);
  });
});

test('failed startup closes all constructed SQLite stores and keeps original error', async t => {
  await withInfrastructure(options => {
    const closed = watchCloses(t);
    t.mock.method(UserAuthStore.prototype, 'isConfigured', () => {
      throw new Error('injected startup failure');
    });
    assert.throws(() => createServerInfrastructure(options), /injected startup failure/);
    assert.deepEqual(closed, expectedCloseOrder);

    // A new startup can use the same database after the injected failure.
    t.mock.restoreAll();
    const retry = createServerInfrastructure(options);
    retry.close();
  });
});

test('a throwing close cannot prevent remaining SQLite owners from shutting down', async t => {
  await withInfrastructure(options => {
    const closed = watchCloses(t, 'adminUsers');
    const infrastructure = createServerInfrastructure(options);
    assert.throws(() => infrastructure.close(), /injected close failure/);
    assert.deepEqual(closed, expectedCloseOrder);
    assert.doesNotThrow(() => infrastructure.close());
  });
});
