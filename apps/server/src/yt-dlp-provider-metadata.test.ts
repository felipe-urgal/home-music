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

test('uploader e channel não são promovidos automaticamente para artista', async () => {
  const scratchDir = await mkdtemp(path.join(os.tmpdir(), 'home-music-ytdlp-metadata-'));
  const runner: YtDlpProcessRunner = async request => {
    if (request.args.includes('--dump-single-json')) {
      return {
        stdout: JSON.stringify({
          id: 'video123',
          title: 'Nando.Reis- Por onde Andei- Luau MTV',
          uploader: 'Wander Almeida',
          channel: 'Wander Almeida',
          formats: [
            { format_id: '251', acodec: 'opus', vcodec: 'none', ext: 'webm', abr: 128, asr: 48_000, audio_channels: 2 }
          ]
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
    const result = await provider.prepare(
      { url: 'https://www.youtube.com/watch?v=video123' },
      {
        scratchDir,
        signal: new AbortController().signal,
        config: { [YT_DLP_COMMAND_CONFIG]: '/usr/local/bin/yt-dlp' }
      }
    );

    assert.equal(result.metadata?.title, 'Nando.Reis- Por onde Andei- Luau MTV');
    assert.equal(result.metadata?.artist, null);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
});
