import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ExternalProviderError } from './external-provider.js';
import {
  YT_DLP_COMMAND_CONFIG,
  YT_DLP_EGRESS_LAUNCHER_CONFIG,
  YtDlpProvider,
  type YtDlpProcessRequest,
  type YtDlpProcessRunner
} from './yt-dlp-provider.js';

async function scratch() {
  return mkdtemp(path.join(os.tmpdir(), 'home-music-ytdlp-'));
}

function context(scratchDir: string) {
  return {
    scratchDir,
    signal: new AbortController().signal,
    config: {
      [YT_DLP_COMMAND_CONFIG]: '/opt/home-music/bin/yt-dlp',
      [YT_DLP_EGRESS_LAUNCHER_CONFIG]: '/opt/home-music/bin/provider-egress'
    }
  };
}

test('adapter usa launcher isolado, argumentos fixos e preserva a mídia original', async () => {
  const dir = await scratch();
  let invocation: YtDlpProcessRequest | null = null;
  const runner: YtDlpProcessRunner = async request => {
    invocation = request;
    await writeFile(path.join(request.cwd, 'home-music-media.webm'), Buffer.from('audio-original'));
    return {
      stdout: JSON.stringify({
        id: 'abc123',
        title: ' Minha faixa ',
        artist: ' Artista ',
        album: ' Álbum ',
        thumbnail: 'https://cdn.example.test/capa.jpg'
      }),
      stderr: ''
    };
  };

  try {
    const provider = new YtDlpProvider(runner);
    const result = await provider.prepare({ url: 'https://media.example.test/watch?v=abc123' }, context(dir));

    assert.equal(invocation?.launcherPath, '/opt/home-music/bin/provider-egress');
    assert.equal(invocation?.commandPath, '/opt/home-music/bin/yt-dlp');
    assert.equal(invocation?.cwd, dir);
    assert.deepEqual(invocation?.args.slice(0, 6), [
      '--ignore-config',
      '--no-config-locations',
      '--no-playlist',
      '--no-simulate',
      '--no-progress',
      '--no-warnings'
    ]);
    assert.equal(invocation?.args.includes('--extract-audio'), false);
    assert.equal(invocation?.args.includes('--audio-format'), false);
    assert.equal(invocation?.args.includes('--no-check-certificates'), false);
    assert.equal(invocation?.args.at(-1), 'https://media.example.test/watch?v=abc123');
    assert.equal(result.relativePath, 'home-music-media.webm');
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

test('adapter recusa execução sem caminhos absolutos e saída ambígua', async () => {
  const dir = await scratch();
  try {
    const provider = new YtDlpProvider(async request => {
      await writeFile(path.join(request.cwd, 'home-music-media.m4a'), 'one');
      await writeFile(path.join(request.cwd, 'home-music-media.webm'), 'two');
      return { stdout: JSON.stringify({ id: 'x', title: 'Faixa' }), stderr: '' };
    });

    await assert.rejects(
      () => provider.prepare(
        { url: 'https://example.test/audio' },
        { ...context(dir), config: { [YT_DLP_COMMAND_CONFIG]: 'yt-dlp', [YT_DLP_EGRESS_LAUNCHER_CONFIG]: '/sandbox' } }
      ),
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

test('adapter rejeita protocolos, localhost e credenciais embutidas antes de executar', () => {
  const provider = new YtDlpProvider(async () => {
    throw new Error('runner não deveria ser executado');
  });
  for (const url of [
    'file:///tmp/audio.mp3',
    'http://localhost/audio',
    'https://user:secret@example.test/audio'
  ]) {
    assert.throws(
      () => provider.validate({ url }),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_input'
    );
  }
});

test('metadata malformada ou arquivo vazio são tratados como saída inválida', async () => {
  const dir = await scratch();
  try {
    const invalidJson = new YtDlpProvider(async request => {
      await writeFile(path.join(request.cwd, 'home-music-media.m4a'), 'audio');
      return { stdout: 'não é json', stderr: 'segredo que não deve chegar ao cliente' };
    });
    await assert.rejects(
      () => invalidJson.prepare({ url: 'https://example.test/audio' }, context(dir)),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_output'
    );

    await rm(path.join(dir, 'home-music-media.m4a'));
    const empty = new YtDlpProvider(async request => {
      await writeFile(path.join(request.cwd, 'home-music-media.m4a'), '');
      return { stdout: JSON.stringify({ id: 'x' }), stderr: '' };
    });
    await assert.rejects(
      () => empty.prepare({ url: 'https://example.test/audio' }, context(dir)),
      (error: unknown) => error instanceof ExternalProviderError && error.code === 'invalid_output'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
