import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(rootDir, 'apps', 'server');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-production-auth-'));
const musicDir = path.join(tempDir, 'music');
const databasePath = path.join(tempDir, 'data', 'smoke-auth.db');
const missingFfmpegPath = path.join(tempDir, 'missing-ffmpeg');
const adminUsername = 'smoke-admin';
const adminPassword = 'smoke-admin-password-2026';
const userUsername = 'smoke-listener';
const userPassword = 'smoke-listener-password-2026';

await mkdir(musicDir, { recursive: true });
await mkdir(path.dirname(databasePath), { recursive: true });

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Não foi possível reservar uma porta para o smoke de autenticação.'));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer(withBootstrapCredentials) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let logs = '';
  let exitResult = null;

  const child = spawn(
    process.execPath,
    ['--import', './dist/bootstrap-preload.js', 'dist/index.js'],
    {
      cwd: serverDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MUSIC_DIR: musicDir,
        HOME_MUSIC_DATABASE_PATH: databasePath,
        HOME_MUSIC_USER: withBootstrapCredentials ? adminUsername : '',
        HOME_MUSIC_PASSWORD: withBootstrapCredentials ? adminPassword : '',
        HOME_MUSIC_COOKIE_SECURE: 'false',
        HOME_MUSIC_FFMPEG_PATH: missingFfmpegPath,
        HOME_MUSIC_TRANSCODE_CACHE_MB: '64',
        PORT: String(port),
        PRODUCTION_HOST: '127.0.0.1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  function appendLog(chunk) {
    logs = `${logs}${chunk.toString()}`.slice(-100_000);
  }
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);

  const exitPromise = new Promise(resolve => {
    child.once('exit', (code, signal) => {
      exitResult = { code, signal };
      resolve(exitResult);
    });
  });

  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (exitResult) {
      throw new Error(`Servidor encerrou antes do smoke de autenticação: ${JSON.stringify(exitResult)}\n${logs}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.status === 200) break;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }

  if (Date.now() >= deadline) {
    child.kill('SIGTERM');
    throw new Error(`Timeout aguardando servidor de autenticação: ${String(lastError)}\n${logs}`);
  }

  return {
    baseUrl,
    logs: () => logs,
    async stop() {
      if (!exitResult) child.kill('SIGTERM');
      const result = await Promise.race([
        exitPromise,
        delay(10_000).then(() => null)
      ]);
      if (!result) {
        child.kill('SIGKILL');
        throw new Error(`Servidor de autenticação não encerrou após SIGTERM.\n${logs}`);
      }
      assert.equal(result.signal, null, `Servidor encerrou por sinal.\n${logs}`);
      assert.equal(result.code, 0, `Servidor encerrou com erro.\n${logs}`);
    }
  };
}

async function login(baseUrl, username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ username, password })
  });
  const body = await response.json();
  const setCookie = response.headers.get('set-cookie');
  return {
    response,
    body,
    cookie: setCookie?.split(';', 1)[0] ?? ''
  };
}

function assertBootstrapPersisted() {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const users = db.prepare(`
      SELECT username, username_normalized, password_hash, role, enabled, password_must_change
      FROM users
      ORDER BY created_at ASC, id ASC;
    `).all();
    assert.equal(users.length, 1, 'Bootstrap deve persistir somente o primeiro admin no banco novo.');
    assert.equal(users[0].username, adminUsername);
    assert.equal(users[0].username_normalized, adminUsername);
    assert.equal(users[0].role, 'admin');
    assert.equal(users[0].enabled, 1);
    assert.equal(users[0].password_must_change, 0);
    assert.equal(typeof users[0].password_hash, 'string');
    assert.ok(users[0].password_hash.length > 20);
    assert.notEqual(users[0].password_hash, adminPassword, 'Senha do bootstrap nunca pode ser persistida em claro.');
  } finally {
    db.close();
  }
}

let firstServer;
let secondServer;
try {
  firstServer = await startServer(true);
  assertBootstrapPersisted();

  const adminLogin = await login(firstServer.baseUrl, adminUsername, adminPassword);
  assert.equal(adminLogin.response.status, 200);
  assert.deepEqual(adminLogin.body, {
    authenticated: true,
    passwordChangeRequired: false
  });
  assert.ok(adminLogin.cookie.startsWith('home_music_session='));

  const adminStatus = await fetch(`${firstServer.baseUrl}/api/auth/status`, {
    headers: { Cookie: adminLogin.cookie }
  });
  assert.equal(adminStatus.status, 200);
  const adminStatusBody = await adminStatus.json();
  assert.equal(adminStatusBody.authenticated, true);
  assert.equal(adminStatusBody.user?.username, adminUsername);
  assert.equal(adminStatusBody.user?.role, 'admin');

  const createUser = await fetch(`${firstServer.baseUrl}/api/admin/users`, {
    method: 'POST',
    headers: {
      Cookie: adminLogin.cookie,
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ username: userUsername, role: 'user' })
  });
  assert.equal(createUser.status, 201);
  const created = await createUser.json();
  assert.equal(created.user?.username, userUsername);
  assert.equal(created.user?.role, 'user');
  assert.equal(created.user?.enabled, true);
  assert.equal(created.user?.passwordMustChange, true);
  assert.equal(typeof created.temporaryPassword, 'string');
  assert.ok(created.temporaryPassword.length >= 20);

  const temporaryLogin = await login(firstServer.baseUrl, userUsername, created.temporaryPassword);
  assert.equal(temporaryLogin.response.status, 200);
  assert.deepEqual(temporaryLogin.body, {
    authenticated: true,
    passwordChangeRequired: true
  });
  assert.ok(temporaryLogin.cookie.startsWith('home_music_session='));

  const temporaryStatus = await fetch(`${firstServer.baseUrl}/api/auth/status`, {
    headers: { Cookie: temporaryLogin.cookie }
  });
  assert.equal(temporaryStatus.status, 200);
  const temporaryStatusBody = await temporaryStatus.json();
  assert.equal(temporaryStatusBody.user?.username, userUsername);
  assert.equal(temporaryStatusBody.user?.role, 'user');
  assert.equal(temporaryStatusBody.passwordChangeRequired, true);

  const blockedLibrary = await fetch(`${firstServer.baseUrl}/api/library`, {
    headers: { Cookie: temporaryLogin.cookie }
  });
  assert.equal(blockedLibrary.status, 403);
  assert.deepEqual(await blockedLibrary.json(), {
    error: 'Troca de senha obrigatória antes de continuar.',
    code: 'PASSWORD_CHANGE_REQUIRED'
  });

  const passwordChange = await fetch(`${firstServer.baseUrl}/api/auth/password`, {
    method: 'POST',
    headers: {
      Cookie: temporaryLogin.cookie,
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({
      currentPassword: created.temporaryPassword,
      newPassword: userPassword
    })
  });
  assert.equal(passwordChange.status, 200);
  assert.deepEqual(await passwordChange.json(), { passwordChanged: true });

  const revokedTemporarySession = await fetch(`${firstServer.baseUrl}/api/library`, {
    headers: { Cookie: temporaryLogin.cookie }
  });
  assert.equal(revokedTemporarySession.status, 401, 'Troca de senha deve revogar a sessão temporária.');

  const userLogin = await login(firstServer.baseUrl, userUsername, userPassword);
  assert.equal(userLogin.response.status, 200);
  assert.deepEqual(userLogin.body, {
    authenticated: true,
    passwordChangeRequired: false
  });

  const userLibrary = await fetch(`${firstServer.baseUrl}/api/library`, {
    headers: { Cookie: userLogin.cookie }
  });
  assert.equal(userLibrary.status, 200);

  const forbiddenAdmin = await fetch(`${firstServer.baseUrl}/api/admin/users`, {
    headers: { Cookie: userLogin.cookie }
  });
  assert.equal(forbiddenAdmin.status, 403);
  assert.deepEqual(await forbiddenAdmin.json(), { error: 'Acesso administrativo necessário.' });

  const adminStillValid = await fetch(`${firstServer.baseUrl}/api/admin/users`, {
    headers: { Cookie: adminLogin.cookie }
  });
  assert.equal(adminStillValid.status, 200);
  assert.equal((await adminStillValid.json()).users.length, 2);

  await firstServer.stop();
  firstServer = undefined;

  secondServer = await startServer(false);

  const persistedAdminLogin = await login(secondServer.baseUrl, adminUsername, adminPassword);
  assert.equal(persistedAdminLogin.response.status, 200, 'Admin deve continuar autenticando sem credenciais de bootstrap no ambiente.');
  assert.equal(persistedAdminLogin.body.passwordChangeRequired, false);

  const persistedUserLogin = await login(secondServer.baseUrl, userUsername, userPassword);
  assert.equal(persistedUserLogin.response.status, 200, 'User deve continuar autenticando após restart com o SQLite persistido.');
  assert.equal(persistedUserLogin.body.passwordChangeRequired, false);

  const persistedUserStatus = await fetch(`${secondServer.baseUrl}/api/auth/status`, {
    headers: { Cookie: persistedUserLogin.cookie }
  });
  assert.equal(persistedUserStatus.status, 200);
  const persistedUserStatusBody = await persistedUserStatus.json();
  assert.equal(persistedUserStatusBody.user?.username, userUsername);
  assert.equal(persistedUserStatusBody.user?.role, 'user');
  assert.equal(persistedUserStatusBody.passwordChangeRequired, false);

  console.log('Production auth smoke test passed.');
} finally {
  if (firstServer) {
    try { await firstServer.stop(); } catch { /* preserva erro original */ }
  }
  if (secondServer) {
    try { await secondServer.stop(); } catch { /* preserva erro original */ }
  }
  await rm(tempDir, { recursive: true, force: true });
}
