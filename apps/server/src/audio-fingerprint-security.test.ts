import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { lookupAcoustIdFingerprint } from './acoustid-fingerprint-lookup.js';
import { fingerprintAudioFile, resolveFingerprintFile, type FpcalcRunner } from './audio-fingerprint.js';
import { HomeMusicDatabase } from './database.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { LibraryAssistantStore } from './library-assistant-store.js';

test('security: subprocesso de fingerprint não propaga command line, path ou stderr', async () => {
  const secretPath = '/srv/music/private/artist/track.flac';
  const runner: FpcalcRunner = async () => {
    const error = new Error(`Command failed: fpcalc ${secretPath}\nTOKEN=secret`) as Error & {
      code?: string;
      stderr?: string;
    };
    error.code = 'EIO';
    error.stderr = `permission denied: ${secretPath}`;
    throw error;
  };

  await assert.rejects(
    fingerprintAudioFile(secretPath, { runner }),
    error => error instanceof Error
      && error.message === 'Chromaprint/fpcalc não conseguiu gerar o fingerprint.'
      && !error.message.includes(secretPath)
      && !error.message.includes('TOKEN')
      && !error.message.includes('secret')
  );
});

test('security: realpath bloqueia symlink que sai de MUSIC_DIR', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-fingerprint-security-'));
  const root = path.join(directory, 'music');
  const outside = path.join(directory, 'outside.flac');
  const link = path.join(root, 'escape.flac');
  try {
    await mkdir(root, { recursive: true });
    await writeFile(outside, 'outside-audio');
    await symlink(outside, link);

    await assert.rejects(
      resolveFingerprintFile(root, link),
      error => error instanceof Error
        && /confinado/.test(error.message)
        && !error.message.includes(directory)
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('security: AcoustID usa egress fixo e não coloca segredo/fingerprint na URL', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'home-music-acoustid-security-'));
  const databasePath = path.join(directory, 'home-music.db');
  const database = new HomeMusicDatabase(databasePath);
  database.close();
  const store = new LibraryAssistantStore(databasePath);
  const providers = new LibraryAssistantProviderGateway(store, { minIntervalMs: 0 });
  const apiKey = 'super-secret-application-key';
  const fingerprint = 'AQAB_private_fingerprint_123';
  let requestedUrl = '';
  let requestedBody = '';
  try {
    await lookupAcoustIdFingerprint(providers, {
      apiKey,
      durationSeconds: 182,
      fingerprint
    }, {
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ status: 'ok', results: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    assert.equal(requestedUrl, 'https://api.acoustid.org/v2/lookup');
    assert.equal(requestedUrl.includes(apiKey), false);
    assert.equal(requestedUrl.includes(fingerprint), false);
    assert.equal(new URLSearchParams(requestedBody).get('client'), apiKey);
    assert.equal(new URLSearchParams(requestedBody).get('fingerprint'), fingerprint);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
