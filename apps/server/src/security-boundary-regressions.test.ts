import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import type { AdminTrack } from '@home-music/shared';
import {
  PERMANENT_DELETE_CONFIRMATION,
  registerAdminTrackRoutes
} from './admin-track-routes.js';
import { SESSION_COOKIE_NAME, SessionManager } from './auth.js';
import { installApiAuthPolicy } from './auth-policy.js';
import {
  ExternalProviderError,
  ExternalProviderImportManager,
  type ExternalProvider,
  type ExternalProviderPreparedMedia
} from './external-provider.js';
import { ExternalProviderScratchManager } from './external-provider-scratch.js';
import { ImportJobQueue } from './import-job-queue.js';
import { ImportStagingManager } from './import-staging.js';
import { ImportUploadError, ImportUploadManager } from './import-upload.js';
import { ImportUrlManager } from './import-url.js';
import { auditLibraryIntegrity, scanLibrary } from './library.js';
import {
  MediaFileMoveOperationError,
  MediaFileMoveStore
} from './media-file-move.js';
import { resolveLibraryRoot, UnsafeLibraryPathError } from './security.js';
import type { AuthenticatedUserState } from './user-auth-store.js';
import {
  YT_DLP_COMMAND_CONFIG,
  YtDlpProvider,
  runYtDlpProcess
} from './yt-dlp-provider.js';

function cookie(token: string) {
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function waitForJobStatus(queue: ImportJobQueue, id: string, expected: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = queue.get(id);
    if (job?.status === expected) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Job ${id} não chegou ao estado ${expected}. Atual: ${queue.get(id)?.status}`);
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  return false;
}

function fakeResponse(options: {
  statusCode?: number;
  headers?: Record<string, string>;
  chunks?: Uint8Array[];
} = {}) {
  const response = Readable.from(options.chunks ?? [Buffer.from('audio')]) as IncomingMessage;
  response.statusCode = options.statusCode ?? 200;
  response.headers = options.headers ?? {
    'content-type': 'audio/mpeg',
    'content-length': '5'
  };
  return response;
}

function fakeRequestFor(response: IncomingMessage) {
  return {
    destroy(error?: Error) {
      response.destroy(error);
      return this;
    }
  } as unknown as ReturnType<typeof http.request>;
}

function seedMoveDatabase(databasePath: string, sourcePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      folder TEXT NOT NULL,
      folder_path TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO tracks(id, file_path, folder, folder_path)
    VALUES ('track-a', ?, 'Origem', 'Origem');
  `).run(sourcePath);
  db.close();
}

function currentMovePath(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    return (db.prepare('SELECT file_path FROM tracks WHERE id = ?;').get('track-a') as { file_path: string }).file_path;
  } finally {
    db.close();
  }
}

function seedAdminTrackDatabase(databasePath: string, sourcePath: string) {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      album_artist TEXT NOT NULL,
      folder TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      has_cover INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(`
    INSERT INTO tracks(
      id, file_path, title, artist, album, album_artist, folder, folder_path, has_cover
    ) VALUES (
      'track-a', ?, 'Faixa', 'Artista', 'Álbum', 'Artista', 'Artista', 'Artista', 0
    );
  `).run(sourcePath);
  db.close();
}

function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

test('namespace admin e anti-CSRF permanecem fail-closed em conjunto', async () => {
  const sessions = new SessionManager('', '', undefined, undefined, { status: 'blocked' });
  const users = new Map<string, AuthenticatedUserState>();
  const app = Fastify();

  installApiAuthPolicy(app, {
    configured: true,
    sessions,
    users: { getEnabledUserById: userId => users.get(userId) ?? null }
  });
  app.post('/api/admin/security-regression-probe', async request => ({ ok: true, user: request.user }));

  users.set('admin-1', {
    id: 'admin-1',
    username: 'felipe',
    role: 'admin',
    passwordMustChange: false
  });
  users.set('user-1', {
    id: 'user-1',
    username: 'maria',
    role: 'user',
    passwordMustChange: false
  });
  const adminToken = sessions.createSessionForUser('admin-1');
  const userToken = sessions.createSessionForUser('user-1');

  try {
    const wrongRole = await app.inject({
      method: 'POST',
      url: '/api/admin/security-regression-probe',
      headers: {
        cookie: cookie(userToken),
        'x-home-music-request': '1'
      }
    });
    assert.equal(wrongRole.statusCode, 403);
    assert.deepEqual(wrongRole.json(), { error: 'Acesso administrativo necessário.' });

    const missingCsrf = await app.inject({
      method: 'POST',
      url: '/api/admin/security-regression-probe',
      headers: { cookie: cookie(adminToken) }
    });
    assert.equal(missingCsrf.statusCode, 403);

    const allowed = await app.inject({
      method: 'POST',
      url: '/api/admin/security-regression-probe',
      headers: {
        cookie: cookie(adminToken),
        'x-home-music-request': '1'
      }
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().user.role, 'admin');
  } finally {
    await app.close();
  }
});

test('upload rejeita nomes malformados, tamanho inválido e overflow sem tocar MUSIC_DIR', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-upload-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const uploads = new ImportUploadManager({ queue, staging, maxBytes: 8 });

  try {
    for (const fileName of [
      '',
      '.',
      '..',
      '../escape.mp3',
      'folder/faixa.mp3',
      'folder\\faixa.mp3',
      'controle\u0000.mp3',
      'quebra\nlinha.mp3',
      `${'a'.repeat(513)}.mp3`,
      'executavel.exe'
    ]) {
      await assert.rejects(
        () => uploads.start(fileName, 4),
        (error: unknown) => error instanceof ImportUploadError && error.statusCode === 400,
        fileName
      );
    }

    for (const declaredSize of [0, -1, 1.5, '4']) {
      await assert.rejects(
        () => uploads.start('faixa.mp3', declaredSize),
        (error: unknown) => error instanceof ImportUploadError && error.statusCode === 400
      );
    }

    const started = await uploads.start('faixa.mp3', 4);
    await assert.rejects(
      () => uploads.receive(started.job.id, Readable.from([Buffer.alloc(5)])),
      (error: unknown) => error instanceof ImportUploadError && error.statusCode === 413
    );

    assert.equal(queue.get(started.job.id)?.status, 'failed');
    assert.equal(staging.hasJob(started.job.id), false);
    assert.deepEqual(await readdir(musicDir), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('URL revalida DNS em redirect e bloqueia destino privado sem vazar query', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-url-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  let requestCalls = 0;
  const resolvedHosts: string[] = [];
  const urls = new ImportUrlManager({
    queue,
    staging,
    maxBytes: 64,
    timeoutMs: 1_000,
    maxRedirects: 2,
    resolveHost: async hostname => {
      resolvedHosts.push(hostname);
      if (hostname === 'redirect.example') {
        return [{ address: '169.254.169.254', family: 4 }];
      }
      return [{ address: '93.184.216.34', family: 4 }];
    },
    requestUrl: async () => {
      requestCalls += 1;
      const response = fakeResponse({
        statusCode: 302,
        headers: { location: 'http://redirect.example/metadata' },
        chunks: []
      });
      return { response, request: fakeRequestFor(response) };
    },
    validateAudio: async () => undefined
  });

  try {
    const { job } = await urls.start('https://public.example/audio.mp3?token=segredo');
    const failed = await waitForJobStatus(queue, job.id, 'failed');

    assert.match(failed.error ?? '', /rede não permitida/i);
    assert.equal(job.label.includes('token='), false);
    assert.deepEqual(resolvedHosts, ['public.example', 'redirect.example']);
    assert.equal(requestCalls, 1);
    assert.equal(staging.hasJob(job.id), false);
    assert.deepEqual(await readdir(musicDir), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('movimentação administrativa bloqueia traversal, symlink escape e colisão sem alterar origem', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-move-'));
  const musicDir = path.join(root, 'music');
  const sourceDir = path.join(musicDir, 'Origem');
  const sourcePath = path.join(sourceDir, 'faixa.mp3');
  const databasePath = path.join(root, 'home-music.db');
  const outside = path.join(root, 'outside');
  await mkdir(sourceDir, { recursive: true });
  await mkdir(outside);
  await writeFile(sourcePath, 'origem');
  seedMoveDatabase(databasePath, sourcePath);
  const store = new MediaFileMoveStore(databasePath, musicDir);

  try {
    await assert.rejects(
      store.move('track-a', { folderPath: '../fora', fileName: 'faixa.mp3' }, () => ({ ok: true })),
      (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 400
    );

    await symlink(outside, path.join(musicDir, 'Escape'));
    await assert.rejects(
      store.move('track-a', { folderPath: 'Escape', fileName: 'faixa.mp3' }, () => ({ ok: true })),
      (error: unknown) => error instanceof UnsafeLibraryPathError
    );

    const collisionDir = path.join(musicDir, 'Destino');
    await mkdir(collisionDir);
    const collisionPath = path.join(collisionDir, 'faixa.mp3');
    await writeFile(collisionPath, 'destino-existente');
    await assert.rejects(
      store.move('track-a', { folderPath: 'Destino', fileName: 'faixa.mp3' }, () => ({ ok: true })),
      (error: unknown) => error instanceof MediaFileMoveOperationError && error.statusCode === 409
    );

    assert.equal(await readFile(sourcePath, 'utf8'), 'origem');
    assert.equal(await readFile(collisionPath, 'utf8'), 'destino-existente');
    assert.equal(currentMovePath(databasePath), sourcePath);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('lixeira preserva reversibilidade até confirmação exata do delete permanente', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-quarantine-'));
  const musicDir = path.join(root, 'music');
  const sourceDir = path.join(musicDir, 'Artista');
  const sourcePath = path.join(sourceDir, 'faixa.mp3');
  const databasePath = path.join(root, 'home-music.db');
  await mkdir(sourceDir, { recursive: true });
  await writeFile(sourcePath, 'audio');
  seedAdminTrackDatabase(databasePath, sourcePath);

  let runtimeTrack: AdminTrack = {
    id: 'track-a',
    title: 'Faixa',
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Artista',
    folderPath: 'Artista',
    duration: 120,
    format: 'MP3',
    hasCover: false,
    enabled: true
  };
  const app = Fastify();
  registerAdminTrackRoutes(app, {
    listTracks: () => [runtimeTrack],
    setEnabled: (trackId, enabled) => {
      if (trackId !== runtimeTrack.id) return null;
      runtimeTrack = { ...runtimeTrack, enabled };
      return runtimeTrack;
    },
    setLocation: () => null
  }, { databasePath, musicDir });

  try {
    const quarantined = await app.inject({
      method: 'POST',
      url: '/api/admin/tracks/track-a/quarantine'
    });
    assert.equal(quarantined.statusCode, 200);
    await assert.rejects(access(sourcePath));

    const missingConfirmation = await app.inject({
      method: 'DELETE',
      url: '/api/admin/quarantine/track-a',
      payload: {}
    });
    assert.equal(missingConfirmation.statusCode, 400);

    const stillRecoverable = await app.inject({ method: 'GET', url: '/api/admin/quarantine' });
    assert.equal(stillRecoverable.statusCode, 200);
    assert.equal(stillRecoverable.json().tracks.length, 1);

    const wrongConfirmation = await app.inject({
      method: 'DELETE',
      url: '/api/admin/quarantine/track-a',
      payload: { confirmation: 'CONFIRMAR' }
    });
    assert.equal(wrongConfirmation.statusCode, 400);

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/admin/quarantine/track-a',
      payload: { confirmation: PERMANENT_DELETE_CONFIRMATION }
    });
    assert.equal(deleted.statusCode, 204);

    const emptyTrash = await app.inject({ method: 'GET', url: '/api/admin/quarantine' });
    assert.equal(emptyTrash.json().tracks.length, 0);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('provider rejeita metadata inválida sem expor stderr ou paths internos', async () => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-ytdlp-output-'));
  const provider = new YtDlpProvider({
    runner: async () => ({
      stdout: '{json-invalido',
      stderr: '/srv/home-music/private/token=segredo'
    }),
    createProxy: async () => ({
      url: 'http://127.0.0.1:45678',
      close: async () => undefined
    })
  });

  try {
    await assert.rejects(
      () => provider.prepare(
        { url: 'https://example.com/audio' },
        {
          scratchDir,
          signal: new AbortController().signal,
          config: { [YT_DLP_COMMAND_CONFIG]: process.execPath }
        }
      ),
      (error: unknown) => {
        assert.ok(error instanceof ExternalProviderError);
        assert.equal(error.code, 'invalid_output');
        assert.equal(error.message.includes('segredo'), false);
        assert.equal(error.message.includes('/srv/home-music/private'), false);
        return true;
      }
    );
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});

test('timeout do provider aborta contexto e limpa scratch/staging sem promover arquivo', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-provider-timeout-'));
  const musicDir = path.join(root, 'music');
  const stagingRoot = path.join(root, 'staging');
  const scratchRoot = path.join(root, 'provider-scratch');
  await mkdir(musicDir);
  const queue = new ImportJobQueue();
  const staging = new ImportStagingManager({ stagingRoot, musicDir });
  const scratch = new ExternalProviderScratchManager({ scratchRoot, musicDir });
  let aborted = false;
  const slowProvider: ExternalProvider = {
    id: 'slow',
    label: 'Slow',
    capabilities: { audio: true, metadata: false, thumbnail: false, playlists: false },
    validate: () => undefined,
    prepare: async (_request, context) => new Promise<ExternalProviderPreparedMedia>((_resolve, reject) => {
      context.signal.addEventListener('abort', () => {
        aborted = true;
        reject(context.signal.reason);
      }, { once: true });
    })
  };
  const manager = new ExternalProviderImportManager({
    queue,
    staging,
    scratch,
    providers: [slowProvider],
    timeoutMs: 15,
    maxOutputBytes: 64
  });

  try {
    const { job } = await manager.start('slow', { url: 'https://example.com/audio' });
    const failed = await waitForJobStatus(queue, job.id, 'failed');
    assert.equal(aborted, true);
    assert.equal(failed.error, 'O provider externo excedeu o tempo limite.');
    assert.equal(staging.hasJob(job.id), false);
    assert.deepEqual(await readdir(musicDir), []);
    assert.deepEqual(await readdir(scratchRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('abort do runner encerra também processo filho do provider', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-process-tree-'));
  const pidFile = path.join(root, 'child.pid');
  const controller = new AbortController();
  let childPid: number | null = null;
  const script = [
    "const { spawn } = require('node:child_process');",
    "const fs = require('node:fs');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "fs.writeFileSync(process.argv[1], String(child.pid));",
    "setInterval(() => {}, 1000);"
  ].join('');

  try {
    const running = runYtDlpProcess({
      commandPath: process.execPath,
      args: ['-e', script, pidFile],
      cwd: root,
      proxyUrl: 'http://127.0.0.1:45678',
      signal: controller.signal
    });

    assert.equal(await waitUntil(async () => {
      try {
        await access(pidFile);
        return true;
      } catch {
        return false;
      }
    }), true);

    childPid = Number(await readFile(pidFile, 'utf8'));
    assert.equal(Number.isInteger(childPid) && childPid > 0, true);
    assert.equal(processExists(childPid), true);

    controller.abort(new Error('timeout de segurança do teste'));
    await assert.rejects(running, /timeout de segurança do teste/);
    assert.equal(await waitUntil(() => !processExists(childPid!), 4_000), true);
  } finally {
    if (childPid && processExists(childPid)) {
      try {
        process.kill(childPid, 'SIGKILL');
      } catch {
        // Processo já finalizado entre a checagem e o cleanup.
      }
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('auditoria de Integridade continua read-only diante de arquivo ausente e não indexado', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-security-integrity-'));
  const musicDir = path.join(root, 'music');
  await mkdir(musicDir);
  const indexedFile = path.join(musicDir, 'Indexada.mp3');
  await writeFile(indexedFile, 'arquivo indexado');

  try {
    const libraryRoot = await resolveLibraryRoot(musicDir);
    const initial = await scanLibrary(libraryRoot);
    const snapshot = initial.tracks.map(track => ({ ...track }));

    await rm(indexedFile);
    await writeFile(path.join(musicDir, 'Nova.mp3'), 'arquivo novo');
    const audit = await auditLibraryIntegrity(libraryRoot, snapshot);

    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].filePath, indexedFile);
    assert.equal(
      audit.issues.some(issue => issue.kind === 'missing-file' && issue.trackId === snapshot[0].id),
      true
    );
    assert.equal(
      audit.issues.some(issue => issue.kind === 'unindexed-file' && issue.relativePath === 'Nova.mp3'),
      true
    );
    assert.equal(await readFile(path.join(musicDir, 'Nova.mp3'), 'utf8'), 'arquivo novo');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
