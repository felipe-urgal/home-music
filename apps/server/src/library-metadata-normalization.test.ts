import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  LibraryMetadataNormalizationStore,
  normalizationComparisonKey
} from './library-metadata-normalization.js';

function seedDatabase(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT NOT NULL
      );
      CREATE TABLE track_metadata_overrides (
        track_id TEXT PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
        title TEXT,
        artist TEXT,
        album TEXT,
        album_artist TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO tracks(id, title, artist, album, album_artist) VALUES (?, ?, ?, ?, ?);');
    insert.run('a', 'A', 'Beyoncé', 'Renaissance', 'Beyoncé');
    insert.run('b', 'B', 'Beyonce', ' renaissance ', 'Beyonce');
    insert.run('c', 'C', ' BEYONCÉ ', 'RENAISSANCE', ' BEYONCÉ ');
    insert.run('d', 'D', 'AC/DC', 'Back in Black', 'AC/DC');
    insert.run('e', 'E', 'ACDC', 'Back in Black', 'ACDC');
    insert.run('f', 'F', 'Outro Artista', 'Renaissance', 'Outro Artista');
  } finally {
    db.close();
  }
}

test('heurística conserva pontuação e normaliza apenas acento, caixa e espaços', () => {
  assert.equal(normalizationComparisonKey('  BEYONCÉ  '), normalizationComparisonKey('Beyonce'));
  assert.equal(normalizationComparisonKey(' renaissance   deluxe '), normalizationComparisonKey('Renaissance Deluxe'));
  assert.notEqual(normalizationComparisonKey('AC/DC'), normalizationComparisonKey('ACDC'));
  assert.notEqual(normalizationComparisonKey('The Beatles'), normalizationComparisonKey('Beatles'));
});

test('review encontra candidatos conservadores e mantém álbuns separados por artista', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-'));
  const databasePath = path.join(temp, 'home-music.db');
  try {
    seedDatabase(databasePath);
    const store = new LibraryMetadataNormalizationStore(databasePath);
    const review = store.review(new Date('2026-08-31T12:00:00.000Z'));

    const artist = review.candidates.find(candidate => candidate.kind === 'artist');
    assert.deepEqual(artist?.variants.map(variant => variant.value), [' BEYONCÉ ', 'Beyonce', 'Beyoncé']);
    assert.equal(review.candidates.some(candidate => candidate.variants.some(variant => variant.value === 'AC/DC') && candidate.variants.some(variant => variant.value === 'ACDC')), false);

    const albumScopes = review.candidates
      .filter(candidate => candidate.kind === 'album')
      .map(candidate => candidate.scope);
    assert.ok(albumScopes.includes('Beyoncé') || albumScopes.includes('Beyonce') || albumScopes.includes(' BEYONCÉ '));
    assert.equal(albumScopes.includes('Outro Artista'), false, 'um único álbum do outro artista não deve formar candidato sozinho');
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('associação é lógica, reversível, persistente e não altera metadata física', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-'));
  const databasePath = path.join(temp, 'home-music.db');
  try {
    seedDatabase(databasePath);
    const store = new LibraryMetadataNormalizationStore(databasePath);
    store.associate({
      kind: 'artist',
      canonicalValue: 'Beyoncé',
      sourceValues: ['Beyonce', ' BEYONCÉ ']
    });

    const resolved = store.resolveTrack({ id: 'b', artist: 'Beyonce', album: 'Renaissance', albumArtist: 'Beyonce' });
    assert.equal(resolved.artist, 'Beyoncé');
    assert.equal(resolved.albumArtist, 'Beyoncé');
    assert.equal(store.review().counts.artistCandidates, 0);

    const raw = new DatabaseSync(databasePath);
    const physical = raw.prepare('SELECT artist, album_artist FROM tracks WHERE id = ?').get('b') as Record<string, unknown>;
    assert.equal(physical.artist, 'Beyonce');
    assert.equal(physical.album_artist, 'Beyonce');
    raw.close();

    const aliasId = store.listAliases()[0].id;
    store.close();

    const reopened = new LibraryMetadataNormalizationStore(databasePath);
    assert.equal(reopened.resolveTrack({ id: 'b', artist: 'Beyonce', album: 'Renaissance', albumArtist: 'Beyonce' }).artist, 'Beyoncé');
    assert.equal(reopened.remove(aliasId), true);
    reopened.remove(reopened.listAliases()[0].id);
    assert.equal(reopened.resolveTrack({ id: 'b', artist: 'Beyonce', album: 'Renaissance', albumArtist: 'Beyonce' }).artist, 'Beyonce');
    reopened.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('associação bloqueia falso positivo e cadeia de aliases', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-'));
  const databasePath = path.join(temp, 'home-music.db');
  try {
    seedDatabase(databasePath);
    const store = new LibraryMetadataNormalizationStore(databasePath);
    assert.throws(() => store.associate({
      kind: 'artist',
      canonicalValue: 'AC/DC',
      sourceValues: ['ACDC']
    }), /heurística conservadora/);

    store.associate({
      kind: 'artist',
      canonicalValue: 'Beyoncé',
      sourceValues: ['Beyonce']
    });
    assert.throws(() => store.associate({
      kind: 'artist',
      canonicalValue: ' BEYONCÉ ',
      sourceValues: ['Beyoncé']
    }), /cadeia de aliases|aponta para outra grafia|não está mais presente/);
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('álbum usa artista do álbum canônico como escopo', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-'));
  const databasePath = path.join(temp, 'home-music.db');
  try {
    seedDatabase(databasePath);
    const store = new LibraryMetadataNormalizationStore(databasePath);
    store.associate({
      kind: 'artist',
      canonicalValue: 'Beyoncé',
      sourceValues: ['Beyonce', ' BEYONCÉ ']
    });
    store.associate({
      kind: 'album',
      scope: 'Beyoncé',
      canonicalValue: 'Renaissance',
      sourceValues: [' renaissance ', 'RENAISSANCE']
    });

    const beyonce = store.resolveTrack({ id: 'b', artist: 'Beyonce', album: ' renaissance ', albumArtist: 'Beyonce' });
    const other = store.resolveTrack({ id: 'f', artist: 'Outro Artista', album: 'Renaissance', albumArtist: 'Outro Artista' });
    assert.equal(beyonce.albumArtist, 'Beyoncé');
    assert.equal(beyonce.album, 'Renaissance');
    assert.equal(other.album, 'Renaissance');
    store.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
