import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseLyrics, readTrackLyrics } from './lyrics.js';

describe('lyrics', () => {
  it('parses synchronized LRC lines and ignores metadata', () => {
    expect(parseLyrics('[ar:Artista]\n[00:12.50]Primeira\n[01:02]Segunda', 'lrc')).toEqual({
      source: 'lrc',
      synchronized: true,
      lines: [
        { time: 12.5, text: 'Primeira' },
        { time: 62, text: 'Segunda' }
      ]
    });
  });

  it('reads a same-name sidecar without exposing its path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-'));
    const trackPath = path.join(root, 'song.mp3');
    await writeFile(trackPath, 'audio');
    await writeFile(path.join(root, 'song.txt'), 'Linha 1\nLinha 2');

    await expect(readTrackLyrics(root, trackPath)).resolves.toEqual({
      source: 'txt',
      synchronized: false,
      lines: [
        { time: null, text: 'Linha 1' },
        { time: null, text: 'Linha 2' }
      ]
    });
  });

  it('ignores a sidecar symlink that escapes the library', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-outside-'));
    await mkdir(path.join(root, 'album'));
    const trackPath = path.join(root, 'album', 'song.mp3');
    await writeFile(trackPath, 'audio');
    const outsideLyrics = path.join(outside, 'lyrics.txt');
    await writeFile(outsideLyrics, 'segredo');
    await symlink(outsideLyrics, path.join(root, 'album', 'song.txt'));

    await expect(readTrackLyrics(root, trackPath)).resolves.toBeNull();
  });
});
