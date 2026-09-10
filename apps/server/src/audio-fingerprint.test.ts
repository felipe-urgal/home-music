import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  fingerprintAudioFile,
  probeFpcalc,
  resolveFingerprintFile,
  type FpcalcRunner
} from './audio-fingerprint.js';

test('fpcalc usa argumentos sem shell e aceita JSON limitado', async () => {
  const calls: { command: string; args: readonly string[] }[] = [];
  const runner: FpcalcRunner = async (command, args) => {
    calls.push({ command, args });
    return { stdout: JSON.stringify({ duration: 180.4, fingerprint: 'AQAB_test-123' }), stderr: '' };
  };

  const result = await fingerprintAudioFile('/music/faixa.flac', { command: '/usr/bin/fpcalc', runner });

  assert.deepEqual(result, { durationSeconds: 180, fingerprint: 'AQAB_test-123' });
  assert.deepEqual(calls, [{
    command: '/usr/bin/fpcalc',
    args: ['-json', '-length', '0', '--', '/music/faixa.flac']
  }]);
});

test('erro do processo é sanitizado sem repetir path nem stdout/stderr', async () => {
  const runner: FpcalcRunner = async () => {
    const error = new Error('Command failed: fpcalc /segredo/Musica.flac') as Error & { code?: string };
    error.code = 'EIO';
    throw error;
  };

  await assert.rejects(
    fingerprintAudioFile('/segredo/Musica.flac', { runner }),
    error => error instanceof Error
      && error.message === 'Chromaprint/fpcalc não conseguiu gerar o fingerprint.'
      && !error.message.includes('/segredo')
  );
});

test('timeout, output excessivo e binário ausente produzem diagnóstico acionável', async () => {
  const timeoutRunner: FpcalcRunner = async () => {
    const error = new Error('timeout') as Error & { code?: string; killed?: boolean };
    error.code = 'ETIMEDOUT';
    error.killed = true;
    throw error;
  };
  await assert.rejects(
    fingerprintAudioFile('/music/faixa.flac', { runner: timeoutRunner }),
    /tempo limite/
  );

  const outputRunner: FpcalcRunner = async () => {
    const error = new Error('stdout leaked') as Error & { code?: string };
    error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    throw error;
  };
  await assert.rejects(
    fingerprintAudioFile('/music/faixa.flac', { runner: outputRunner }),
    error => error instanceof Error
      && error.message === 'Chromaprint/fpcalc excedeu o limite de saída permitido.'
      && !error.message.includes('stdout')
  );

  const missingRunner: FpcalcRunner = async () => {
    const error = new Error('missing') as Error & { code?: string };
    error.code = 'ENOENT';
    throw error;
  };
  assert.deepEqual(await probeFpcalc(undefined, missingRunner), {
    available: false,
    version: null,
    issue: 'not-found'
  });
});

test('cancelamento preserva AbortError para liberar o processo chamador', async () => {
  const controller = new AbortController();
  const runner: FpcalcRunner = async (_command, _args, options) => {
    assert.equal(options.signal, controller.signal);
    controller.abort();
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };

  await assert.rejects(
    fingerprintAudioFile('/music/faixa.flac', { runner, signal: controller.signal }),
    error => error instanceof Error && error.name === 'AbortError'
  );
});

test('health reconhece versão do fpcalc sem depender de arquivo de áudio', async () => {
  const runner: FpcalcRunner = async (_command, args) => {
    assert.deepEqual(args, ['-version']);
    return { stdout: 'fpcalc version 1.5.1 (FFmpeg 7.0)', stderr: '' };
  };
  assert.deepEqual(await probeFpcalc('fpcalc', runner), {
    available: true,
    version: '1.5.1',
    issue: null
  });
});

test('resolução usa realpath, exige arquivo regular e invalida assinatura após mudança física', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-fingerprint-'));
  const root = path.join(temp, 'music');
  const outside = path.join(temp, 'outside.flac');
  const file = path.join(root, 'inside.flac');
  try {
    await mkdir(root, { recursive: true });
    await writeFile(file, 'audio-a');
    await writeFile(outside, 'outside');

    const first = await resolveFingerprintFile(root, file);
    await writeFile(file, 'audio-b-longer');
    const second = await resolveFingerprintFile(root, file);
    assert.notEqual(first.signature, second.signature);

    const outsideLink = path.join(root, 'escape.flac');
    await symlink(outside, outsideLink);
    await assert.rejects(resolveFingerprintFile(root, outsideLink), /confinado/);

    const directory = path.join(root, 'not-a-file');
    await mkdir(directory);
    await assert.rejects(resolveFingerprintFile(root, directory), /arquivo regular/);

    await rm(file);
    await assert.rejects(resolveFingerprintFile(root, file), /não está mais disponível/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
