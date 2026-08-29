import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  YT_DLP_COMMAND_CONFIG,
  YtDlpProvider,
  type YtDlpProcessRunner
} from './yt-dlp-provider.js';

async function prepareWithMetadata(metadata: Record<string, unknown>) {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-ytdlp-metadata-'));
  const runner: YtDlpProcessRunner = async request => {
    if (request.args.includes('--dump-single-json')) {
      return {
        stdout: JSON.stringify({
          id: 'video123',
          formats: [
            { format_id: '251', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 128, asr: 48_000, audio_channels: 2 }
          ],
          ...metadata
        }),
        stderr: ''
      };
    }
    await writeFile(path.join(request.cwd, 'home-music-media.webm'), 'audio');
    return { stdout: '', stderr: '' };
  };

  try {
    const provider = new YtDlpProvider({
      runner,
      createProxy: async () => ({ url: 'http://127.0.0.1:45678', close: async () => undefined })
    });
    return await provider.prepare(
      { url: 'https://www.youtube.com/watch?v=video123' },
      {
        scratchDir,
        signal: new AbortController().signal,
        config: { [YT_DLP_COMMAND_CONFIG]: '/usr/local/bin/yt-dlp' }
      }
    );
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

test('vídeo comum infere artista e título quando há contexto musical reconhecido', async () => {
  const result = await prepareWithMetadata({
    title: 'Nando.Reis- Por onde Andei- Luau MTV',
    creator: 'Wander Almeida',
    uploader: 'Wander Almeida',
    channel: 'Wander Almeida'
  });

  assert.equal(result.metadata?.title, 'Por onde Andei');
  assert.equal(result.metadata?.artist, 'Nando Reis');
});

test('título de dois trechos permanece para revisão porque a ordem é ambígua', async () => {
  const result = await prepareWithMetadata({
    title: 'Fácil - Jota Quest',
    creator: 'Canal de música',
    uploader: 'Canal de música',
    channel: 'Canal de música'
  });

  assert.equal(result.metadata?.title, 'Fácil - Jota Quest');
  assert.equal(result.metadata?.artist, null);
});

test('vídeo genérico sem padrão seguro não inventa artista a partir do canal', async () => {
  const result = await prepareWithMetadata({
    title: 'Entrevista completa nos bastidores',
    creator: 'Canal Exemplo',
    uploader: 'Canal Exemplo',
    channel: 'Canal Exemplo'
  });

  assert.equal(result.metadata?.title, 'Entrevista completa nos bastidores');
  assert.equal(result.metadata?.artist, null);
});

test('metadata musical estruturada continua preferindo track e artist do extractor', async () => {
  const result = await prepareWithMetadata({
    title: 'Título do vídeo',
    track: 'Faixa oficial',
    artist: 'Artista oficial',
    creator: 'Canal que não deve prevalecer'
  });

  assert.equal(result.metadata?.title, 'Faixa oficial');
  assert.equal(result.metadata?.artist, 'Artista oficial');
});
