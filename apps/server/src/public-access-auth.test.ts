import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { verifyPublicAccessAdmin } from './public-access-auth.js';

test('Funnel exige admin ativo com senha persistida de 20+ caracteres', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'home-music-public-auth-'));
  const databasePath = join(directory, 'home-music.db');
  try {
    const password = 'senha-publica-exclusiva-12345';
    await bootstrapInitialAdmin({ databasePath, username: 'Admin', password });

    assert.equal(await verifyPublicAccessAdmin(databasePath, 'admin', password), true);
    assert.equal(await verifyPublicAccessAdmin(databasePath, 'admin', 'senha-incorreta-com-20-char'), false);
    assert.equal(await verifyPublicAccessAdmin(databasePath, 'admin', 'curta-demais-123'), false);

    const db = new DatabaseSync(databasePath);
    db.prepare("UPDATE users SET role = 'user' WHERE username_normalized = 'admin';").run();
    db.close();
    assert.equal(await verifyPublicAccessAdmin(databasePath, 'admin', password), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
