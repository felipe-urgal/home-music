import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLyrics, readTrackLyrics } from './lyrics.js';

describe('lyrics', () => {
  it('parses synchronized LRC lines and ignores metadata', () => {
    assert.deepEqual(parseLyrics('[ar:Artista]\n[offset:500]\n[01:02]Segunda\n[00:12.50]Primeira', 'lrc'), {
      source: 'lrc',
      synchronized: true,
      lines: [
        { time: 13, text: 'Primeira' },
        { time: 62.5, text: 'Segunda' }
      ]
    });
  });

  it('reads a same-name sidecar without exposing its path', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-'));
    const trackPath = path.join(root, 'song.mp3');
    await writeFile(trackPath, 'audio');
    await writeFile(path.join(root, 'song.txt'), 'Linha 1\nLinha 2');

    assert.deepEqual(await readTrackLyrics(root, trackPath), {
      source: 'txt',
      synchronized: false,
      lines: [
        { time: null, text: 'Linha 1' },
        { time: null, text: 'Linha 2' }
      ]
    });
  });

  it('prefers an approved managed override over an existing sidecar', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-'));
    const trackPath = path.join(root, 'song.mp3');
    await writeFile(trackPath, 'audio');
    await writeFile(path.join(root, 'song.txt'), 'Sidecar local');

    assert.deepEqual(await readTrackLyrics(root, trackPath, {
      trackId: 'track-1',
      mode: 'synced',
      text: '[00:01.00]Linha gerenciada',
      origin: 'external',
      provider: 'lrclib',
      externalId: '123',
      language: null,
      updatedAt: '2026-09-09T00:00:00.000Z'
    }), {
      source: 'lrc',
      synchronized: true,
      lines: [{ time: 1, text: 'Linha gerenciada' }]
    });
  });

  it('falls back to the physical sidecar when no managed override exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-lyrics-'));
    const trackPath = path.join(root, 'song.mp3');
    await writeFile(trackPath, 'audio');
    await writeFile(path.join(root, 'song.lrc'), '[00:02.00]Sidecar');

    assert.deepEqual(await readTrackLyrics(root, trackPath, null), {
      source: 'lrc',
      synchronized: true,
      lines: [{ time: 2, text: 'Sidecar' }]
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

    assert.equal(await readTrackLyrics(root, trackPath), null);
  });
});
