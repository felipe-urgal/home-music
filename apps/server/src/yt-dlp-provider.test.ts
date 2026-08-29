import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExternalProviderError } from './external-provider.js';
import {
  YT_DLP_COMMAND_CONFIG,
  YtDlpProvider,
  selectYtDlpAudioFormat,
  type YtDlpProcessRequest,
  type YtDlpProcessRunner
} from './yt-dlp-provider.js';

async function scratch() {
  return mkdtemp(path.join(os.tmpdir(), 'home-music-ytdlp-'));
}

function context(scratchDir: string, command = '/opt/home-music/bin/yt-dlp') {
  return {
    scratchDir,
    signal: new AbortController().signal,
    config: { [YT_DLP_COMMAND_CONFIG]: command }
  };
}

function providerWith(runner: YtDlpProcessRunner) {
  return new YtDlpProvider({
    runner,
    createProxy: async () => ({
      url: 'http://127.0.0.1:45678',
      close: async () => undefined
    })
  });
}

test('seleciona áudio original privilegiando audio-only e lossless', () => {
  const selected = selectYtDlpAudioFormat({
    formats: [
      { format_id: 'muxed', acodec: 'aac', vcodec: 'h264', ext: 'mp4', abr: 320, asr: 48000, audio_channels: 2 },
      { format_id: 'opus', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 256, asr: 48000, audio_channels: 2 },
      { format_id: 'flac', acodec: 'flac', vcodec: 'none', ext: 'flac', abr: 900, asr: 48000, audio_channels: 2 }
    ]
  });
  assert.equal(selected.id, 'flac');
  assert.equal(selected.lossless, true);
});

test('YouTube Music usa proxy seguro, Node do serviço e preserva mídia original', async () => {
  const dir = await scratch();
  const calls: YtDlpProcessRequest[] = [];
  const runner: YtDlpProcessRunner = async request => {
    calls.push(request);
    if (request.args.includes('--dump-single-json')) {
      return {
        stdout: JSON.stringify({
          id: 'abc123',
          title: 'Vídeo',
          track: ' Minha faixa ',
          artist: ' Artista ',
          album: ' Álbum ',
          thumbnail: 'https://cdn.example.test/capa.jpg',
          formats: [
            { format_id: '140', acodec: 'aac', vcodec: 'none', ext: 'm4a', abr: 128, asr: 44100, audio_channels: 2 },
            { format_id: '251', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 160, asr: 48000, audio_channels: 2 }
          ]
        }),
        stderr: ''
      };
    }
    assert.equal(request.args[request.args.indexOf('--format') + 1], '251');
    await writeFile(path.join(request.cwd, 'home-music-media.webm'), Buffer.from('audio-original'));
    return { stdout: '', stderr: '' };
  };

  try {
    const provider = providerWith(runner);
    const result = await provider.prepare(
      { url: 'https://music.youtube.com/watch?v=abc123&list=RDAMVMabc123' },
      context(dir)
    );

    assert.equal(calls.length, 2);
    for (const invocation of calls) {
      assert.equal(invocation.commandPath, '/opt/home-music/bin/yt-dlp');
      assert.equal(invocation.proxyUrl, 'http://127.0.0.1:45678');
      assert.equal(invocation.cwd, dir);
      assert.ok(invocation.args.includes('--ignore-config'));
      assert.ok(invocation.args.includes('--no-plugin-dirs'));
      assert.ok(invocation.args.includes('--no-playlist'));
      assert.equal(invocation.args[invocation.args.indexOf('--js-runtimes') + 1], `node:${process.execPath}`);
      assert.equal(invocation.args[invocation.args.indexOf('--proxy') + 1], 'http://127.0.0.1:45678');
      assert.equal(invocation.args.includes('--extract-audio'), false);
      assert.equal(invocation.args.includes('--audio-format'), false);
      assert.equal(invocation.args.includes('--no-check-certificates'), false);
    }
    assert.equal(result.relativePath, 'home-music-media.webm');
    assert.equal(result.contentType, 'audio/webm');
    assert.deepEqual(result.metadata, {
      sourceId: 'abc123',
      title: 'Minha faixa',
      artist: 'Artista',
      album: 'Álbum',
      thumbnailUrl: 'https://cdn.example.test/capa.jpg'
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('adapter exige executável absoluto e recusa saída ambígua', async () => {
  const dir = await scratch();
  try {
    const provider = providerWith(async request => {
      if (request.args.includes('--dump-single-json')) {
        return {
          stdout: JSON.stringify({
            id: 'x',
            formats: [{ format_id: '140', acodec: 'aac', vcodec: 'none', ext: 'm4a' }]
          }),
          stderr: ''
        };
      }
      await writeFile(path.join(request.cwd, 'home-music-media.m4a'), 'one');
      await writeFile(path.join(request.cwd, 'home-music-media.webm'), 'two');
      return { stdout: '', stderr: '' };
    });

    await assert.rejects(
      () => provider.prepare({ url: 'https://example.test/audio' }, context(dir, 'yt-dlp')),
      (error: unknown) => error instanceof ExternalProviderError && error.statusCode === 503
    );

    await assert.rejects(
      () => provider.prepare({ url: 'https://example.test/audio' }, context(dir)),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_output'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('adapter rejeita protocolos, hosts locais, IP privado e credenciais embutidas', () => {
  const provider = providerWith(async () => {
    throw new Error('runner não deveria ser executado');
  });
  for (const url of [
    'file:///tmp/audio.mp3',
    'http://localhost/audio',
    'http://127.0.0.1/audio',
    'https://user:secret@example.test/audio'
  ]) {
    assert.throws(
      () => provider.validate({ url }),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input',
      url
    );
  }
});

test('playlist e metadata sem áudio são recusadas antes do download', async () => {
  const dir = await scratch();
  try {
    const playlist = providerWith(async () => ({
      stdout: JSON.stringify({ _type: 'playlist', entries: [{ id: '1' }] }),
      stderr: ''
    }));
    await assert.rejects(
      () => playlist.prepare({ url: 'https://example.test/playlist' }, context(dir)),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input'
    );

    const noAudio = providerWith(async () => ({
      stdout: JSON.stringify({ formats: [{ format_id: 'video', acodec: 'none', vcodec: 'h264' }] }),
      stderr: ''
    }));
    await assert.rejects(
      () => noAudio.prepare({ url: 'https://example.test/item' }, context(dir)),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_output'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});