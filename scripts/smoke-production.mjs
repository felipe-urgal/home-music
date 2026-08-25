import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-production-'));
const musicDir = path.join(tempDir, 'music');
const databasePath = path.join(tempDir, 'data', 'smoke.db');
const missingFfmpegPath = path.join(tempDir, 'missing-ffmpeg');
const username = 'smoke-user';
const password = 'smoke-password-123';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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
        reject(new Error('Não foi possível reservar uma porta para o smoke test.'));
        return;
      }
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
let logs = '';
let exitResult = null;

const child = spawn(npmCommand, ['start'], {
  cwd: rootDir,
  env: {
    ...process.env,
    MUSIC_DIR: musicDir,
    HOME_MUSIC_DATABASE_PATH: databasePath,
    HOME_MUSIC_USER: username,
    HOME_MUSIC_PASSWORD: password,
    HOME_MUSIC_COOKIE_SECURE: 'false',
    HOME_MUSIC_FFMPEG_PATH: missingFfmpegPath,
    HOME_MUSIC_TRANSCODE_CACHE_MB: '64',
    PORT: String(port),
    PRODUCTION_HOST: '127.0.0.1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

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

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (exitResult) {
      throw new Error(`Servidor encerrou antes do smoke test: ${JSON.stringify(exitResult)}\n${logs}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(150);
  }
  throw new Error(`Timeout aguardando ${url}: ${String(lastError)}\n${logs}`);
}

async function descendantsOf(pid) {
  if (process.platform !== 'linux') return [];
  try {
    const children = (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8'))
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
    const result = [];
    for (const childPid of children) {
      result.push(childPid, ...(await descendantsOf(childPid)));
    }
    return result;
  } catch {
    return [];
  }
}

async function findServerPid() {
  const descendants = await descendantsOf(child.pid);
  for (const pid of [...descendants].reverse()) {
    try {
      const command = await readFile(`/proc/${pid}/cmdline`, 'utf8');
      if (command.includes('apps/server/dist/index.js')) return pid;
    } catch {
      // Processo pode ter encerrado entre a listagem e a leitura.
    }
  }
  return descendants.at(-1) ?? child.pid;
}

async function stopServer(assertCleanExit) {
  if (!exitResult) {
    const serverPid = await findServerPid();
    try {
      process.kill(serverPid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }

  const result = await Promise.race([
    exitPromise,
    delay(10_000).then(() => null)
  ]);

  if (!result) {
    const descendants = await descendantsOf(child.pid);
    for (const pid of [...descendants].reverse()) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* já encerrou */ }
    }
    try { child.kill('SIGKILL'); } catch { /* já encerrou */ }
    throw new Error(`Servidor não encerrou após SIGTERM.\n${logs}`);
  }

  if (assertCleanExit) {
    assert.equal(result.signal, null, `npm start encerrou por sinal.\n${logs}`);
    assert.equal(result.code, 0, `npm start encerrou com erro.\n${logs}`);
  }
}

let smokePassed = false;
try {
  const health = await waitForHttp(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const ready = await fetch(`${baseUrl}/ready`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ready: true });

  const root = await fetch(`${baseUrl}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type') || '', /^text\/html/);
  assert.ok(root.headers.get('content-security-policy'));
  assert.equal(root.headers.get('cache-control'), 'no-store');
  const html = await root.text();
  assert.match(html, /<div[^>]+id=["']root["']/);

  const assetMatch = html.match(/["'](\/assets\/[^"']+)["']/);
  assert.ok(assetMatch, 'index.html não referencia um asset do build Vite.');
  const asset = await fetch(`${baseUrl}${assetMatch[1]}`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control') || '', /immutable/);

  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type') || '', /manifest/);

  const serviceWorker = await fetch(`${baseUrl}/sw.js`);
  assert.equal(serviceWorker.status, 200);
  assert.match(serviceWorker.headers.get('content-type') || '', /javascript/);
  assert.equal(serviceWorker.headers.get('cache-control'), 'no-store');
  const serviceWorkerSource = await serviceWorker.text();
  assert.match(serviceWorkerSource, /home-music-static-/);
  assert.match(serviceWorkerSource, /home-music-offline-audio-v1/);
  assert.match(serviceWorkerSource, /HOME_MUSIC_GET_CAPABILITIES/);
  assert.match(serviceWorkerSource, /\/offline-audio\//);
  assert.ok(
    serviceWorkerSource.includes("pathname === '/api' || pathname.startsWith('/api/')"),
    'Service worker deve reconhecer toda a árvore /api como conteúdo privado.'
  );
  assert.ok(
    serviceWorkerSource.includes('if (isApiPath(url.pathname)) return;'),
    'Service worker não deve interceptar/cachear /api/* automaticamente.'
  );

  const virtualOfflineAudio = await fetch(`${baseUrl}/offline-audio/1234567890abcdef12345678`);
  assert.equal(virtualOfflineAudio.status, 404, 'Fastify nunca deve servir a rota virtual de áudio offline.');

  const missingAsset = await fetch(`${baseUrl}/assets/inexistente.js`);
  assert.equal(missingAsset.status, 404);

  const unauthenticatedLibrary = await fetch(`${baseUrl}/api/library`);
  assert.equal(unauthenticatedLibrary.status, 401);

  const unauthenticatedHealth = await fetch(`${baseUrl}/api/health`);
  assert.equal(unauthenticatedHealth.status, 401);

  const unauthenticatedTranscode = await fetch(`${baseUrl}/api/tracks/inexistente/transcode?quality=economy`);
  assert.equal(unauthenticatedTranscode.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ username, password })
  });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get('set-cookie');
  assert.ok(setCookie?.includes('home_music_session='));
  assert.ok(setCookie?.includes('HttpOnly'));
  assert.ok(setCookie?.includes('SameSite=Strict'));
  assert.ok(!setCookie?.includes('Secure'), 'HTTP local não deve forçar cookie Secure.');
  const cookie = setCookie.split(';', 1)[0];

  const internalHealth = await fetch(`${baseUrl}/api/health`, {
    headers: { Cookie: cookie }
  });
  assert.equal(internalHealth.status, 200);
  const internalHealthBody = await internalHealth.json();
  assert.equal(internalHealthBody.ready, true);
  assert.equal(internalHealthBody.mode, 'production');
  assert.equal(internalHealthBody.webReady, true);
  assert.equal(internalHealthBody.libraryReady, true);
  assert.equal(internalHealthBody.authConfigured, true);
  assert.deepEqual(internalHealthBody.ffmpeg, {
    available: false,
    version: null,
    customPath: true,
    issue: 'not-found'
  });
  assert.deepEqual(internalHealthBody.transcoding, {
    available: false,
    profiles: [],
    cacheLimitMegabytes: 64,
    active: 0,
    pending: 0
  });
  assert.equal(internalHealthBody.schemaVersion, 4);

  const library = await fetch(`${baseUrl}/api/library`, {
    headers: { Cookie: cookie }
  });
  assert.equal(library.status, 200);
  const libraryBody = await library.json();
  assert.deepEqual(libraryBody.tracks, []);

  const missingTrackTranscode = await fetch(`${baseUrl}/api/tracks/inexistente/transcode?quality=economy`, {
    headers: { Cookie: cookie }
  });
  assert.equal(missingTrackTranscode.status, 404);

  await stopServer(true);
  smokePassed = true;
  console.log('Production smoke test passed.');
} finally {
  if (!smokePassed && !exitResult) {
    try { await stopServer(false); } catch { /* erro original é mais útil */ }
  }
  await rm(tempDir, { recursive: true, force: true });
}
