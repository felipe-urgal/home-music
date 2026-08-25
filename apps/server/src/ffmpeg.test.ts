import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FFMPEG_COMMAND,
  parseFfmpegVersion,
  probeFfmpeg,
  resolveFfmpegCommand,
  type FfmpegRunner
} from './ffmpeg.js';

test('resolveFfmpegCommand usa ffmpeg por padrão e aceita caminho customizado', () => {
  assert.equal(resolveFfmpegCommand(undefined), DEFAULT_FFMPEG_COMMAND);
  assert.equal(resolveFfmpegCommand('   '), DEFAULT_FFMPEG_COMMAND);
  assert.equal(resolveFfmpegCommand('/opt/home music/bin/ffmpeg'), '/opt/home music/bin/ffmpeg');
  assert.throws(() => resolveFfmpegCommand(`ffmpeg\0evil`));
});

test('parseFfmpegVersion lê a primeira linha de versão válida', () => {
  assert.equal(parseFfmpegVersion('ffmpeg version 7.1.1 Copyright (c) FFmpeg developers'), '7.1.1');
  assert.equal(parseFfmpegVersion('aviso\nFFmpeg version n7.0-custom build'), 'n7.0-custom');
  assert.equal(parseFfmpegVersion('não é saída do ffmpeg'), null);
});

test('probeFfmpeg executa somente -version e retorna versão disponível', async () => {
  const runner: FfmpegRunner = async (command, args, timeoutMs) => {
    assert.equal(command, '/usr/local/bin/ffmpeg');
    assert.deepEqual(args, ['-version']);
    assert.equal(timeoutMs, 1_234);
    return {
      stdout: 'ffmpeg version 6.1.2-ubuntu Copyright (c) FFmpeg developers\n',
      stderr: ''
    };
  };

  assert.deepEqual(await probeFfmpeg('/usr/local/bin/ffmpeg', runner, 1_234), {
    available: true,
    version: '6.1.2-ubuntu',
    issue: null,
    customCommand: true
  });
});

test('probeFfmpeg não transforma ausência do binário em exceção', async () => {
  const runner: FfmpegRunner = async () => {
    throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  };

  assert.deepEqual(await probeFfmpeg(undefined, runner), {
    available: false,
    version: null,
    issue: 'not-found',
    customCommand: false
  });
});

test('probeFfmpeg diferencia timeout, falha e saída inválida', async () => {
  const timeoutRunner: FfmpegRunner = async () => {
    throw Object.assign(new Error('timeout'), { killed: true });
  };
  const failedRunner: FfmpegRunner = async () => {
    throw Object.assign(new Error('exit 1'), { code: 1 });
  };
  const invalidOutputRunner: FfmpegRunner = async () => ({ stdout: 'qualquer coisa', stderr: '' });

  assert.equal((await probeFfmpeg(undefined, timeoutRunner)).issue, 'timeout');
  assert.equal((await probeFfmpeg(undefined, failedRunner)).issue, 'failed');
  assert.equal((await probeFfmpeg(undefined, invalidOutputRunner)).issue, 'invalid-output');
});

test('probeFfmpeg rejeita configuração inválida sem executar processo', async () => {
  let called = false;
  const runner: FfmpegRunner = async () => {
    called = true;
    return { stdout: '', stderr: '' };
  };

  const result = await probeFfmpeg(`ffmpeg\0evil`, runner);
  assert.equal(called, false);
  assert.deepEqual(result, {
    available: false,
    version: null,
    issue: 'invalid-command',
    customCommand: true
  });
});
