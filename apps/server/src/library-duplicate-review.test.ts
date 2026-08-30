import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  LibraryDuplicateReviewStore,
  type LibraryDuplicateTrack
} from './library-duplicate-review.js';

function track(
  id: string,
  overrides: Partial<LibraryDuplicateTrack> = {}
): LibraryDuplicateTrack {
  return {
    id,
    filePath: overrides.filePath ?? `/music/${id}.flac`,
    title: overrides.title ?? 'Faixa teste',
    artist: overrides.artist ?? 'Artista teste',
    album: overrides.album ?? 'Álbum teste',
    duration: overrides.duration ?? 180,
    format: overrides.format ?? 'FLAC',
    fileSize: overrides.fileSize ?? 1_000,
    mtimeMs: overrides.mtimeMs ?? 1
  };
}

async function fixture(
  tracks: LibraryDuplicateTrack[],
  hashTrack: (track: LibraryDuplicateTrack) => Promise<string | null> = async () => null
) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-library-duplicates-'));
  const databasePath = path.join(root, 'home-music.db');
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY
    );
  `);
  const insert = db.prepare('INSERT INTO tracks(id) VALUES (?);');
  for (const item of tracks) insert.run(item.id);
  db.close();

  const store = new LibraryDuplicateReviewStore({
    databasePath,
    musicDir: '/music',
    libraryTracks: () => tracks,
    hashTrack,
    now: () => new Date('2026-08-30T18:00:00.000Z')
  });
  return { root, store };
}

test('classifica metadata e duração equivalentes como duplicata provável', async () => {
  const items = [
    track('a', { fileSize: 1_000 }),
    track('b', { title: 'Faixa Teste', artist: 'Artísta teste', duration: 181.5, fileSize: 2_000 })
  ];
  const item = await fixture(items);
  try {
    const review = await item.store.check();
    assert.equal(review.counts.reviewable, 1);
    assert.equal(review.counts.probable, 1);
    assert.equal(review.candidates[0].confidence, 'probable');
    assert.ok(review.candidates[0].reasons.includes('title'));
    assert.ok(review.candidates[0].reasons.includes('artist'));
    assert.ok(review.candidates[0].reasons.includes('duration'));
  } finally {
    item.store.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('mesmo título e duração com artista diferente continua apenas possível', async () => {
  const items = [
    track('a', { fileSize: 1_000 }),
    track('b', {
      title: 'Faixa teste',
      artist: 'Outro artista',
      album: 'Outro álbum',
      duration: 180.8,
      fileSize: 2_000
    })
  ];
  const item = await fixture(items);
  try {
    const review = await item.store.check();
    assert.equal(review.counts.probable, 0);
    assert.equal(review.counts.possible, 1);
    assert.equal(review.candidates[0].confidence, 'possible');
    assert.deepEqual([...review.candidates[0].reasons].sort(), ['duration', 'title']);
  } finally {
    item.store.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('hash idêntico eleva o par para duplicata exata', async () => {
  const items = [
    track('a', { title: 'Primeira', artist: 'Artista A', fileSize: 2_048 }),
    track('b', { title: 'Segunda', artist: 'Artista B', album: 'Outro', duration: 240, fileSize: 2_048 })
  ];
  const item = await fixture(items, async () => 'mesmo-sha256');
  try {
    const review = await item.store.check();
    assert.equal(review.hashComplete, true);
    assert.equal(review.counts.exact, 1);
    assert.equal(review.candidates[0].confidence, 'exact');
    assert.deepEqual(review.candidates[0].reasons, ['hash']);
  } finally {
    item.store.close();
    await rm(item.root, { recursive: true, force: true });
  }
});

test('ignorar falso positivo persiste sem alterar as faixas', async () => {
  const items = [
    track('a', { fileSize: 1_000 }),
    track('b', { fileSize: 2_000 })
  ];
  const item = await fixture(items);
  try {
    const first = await item.store.check();
    assert.equal(first.counts.reviewable, 1);

    const ignored = item.store.setIgnored(['a', 'b'], true);
    assert.equal(ignored.ignored, true);

    const second = await item.store.check();
    assert.equal(second.counts.reviewable, 0);
    assert.equal(second.counts.ignored, 1);
    assert.equal(second.candidates[0].ignored, true);
    assert.deepEqual(second.candidates[0].tracks.map(candidate => candidate.id).sort(), ['a', 'b']);

    item.store.setIgnored(['b', 'a'], false);
    const third = await item.store.check();
    assert.equal(third.counts.reviewable, 1);
    assert.equal(third.counts.ignored, 0);
  } finally {
    item.store.close();
    await rm(item.root, { recursive: true, force: true });
  }
});
