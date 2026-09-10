import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { LibraryAssistantStore } from './library-assistant-store.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';

function seedTracks(databasePath: string) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT NOT NULL,
        album_artist TEXT NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO tracks(id, title, artist, album, album_artist) VALUES (?, ?, ?, ?, ?);');
    insert.run('a', 'Faixa A', 'Beyonce', 'Renaissance', 'Beyonce');
    insert.run('b', 'Faixa B', 'Beyoncé', 'Renaissance', 'Beyoncé');
  } finally {
    db.close();
  }
}

function insertMusicBrainzSuggestion(
  store: LibraryAssistantStore,
  input: { runId: string; suggestionId: string; trackId: string; sourceArtist: string; artistId: string }
) {
  store.insertSuggestions([{
    id: input.suggestionId,
    runId: input.runId,
    capability: 'metadata',
    trackId: input.trackId,
    confidence: 'high',
    reasonCodes: ['provider-match', 'normalized-text-match', 'strong-external-id'],
    evidence: [
      {
        type: 'text-match',
        version: 1,
        field: 'artist',
        match: input.sourceArtist === 'Beyoncé' ? 'exact' : 'normalized',
        sourceValue: input.sourceArtist,
        candidateValue: 'Beyoncé'
      },
      {
        type: 'external-id',
        version: 1,
        source: 'musicbrainz',
        kind: 'artist',
        id: input.artistId
      }
    ],
    provenance: {
      source: 'musicbrainz',
      providerVersion: 'fixture',
      externalId: `recording-${input.trackId}`
    },
    target: {
      capability: 'metadata',
      trackId: input.trackId,
      field: 'artist',
      currentValue: input.sourceArtist,
      suggestedValue: 'Beyoncé'
    },
    premiseSignature: 'a'.repeat(64),
    createdAt: '2026-09-10T10:00:00.000Z'
  }]);
}

type EnrichedCandidate = {
  kind: 'artist' | 'album';
  externalEvidence?: {
    source: 'musicbrainz';
    providerCanonical: string | null;
    suggestedCanonical: string | null;
    externalIds: string[];
    conflict: boolean;
    reasonCodes: string[];
  };
};

test('normalização reutiliza evidência MusicBrainz existente para sugerir grafia canônica', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-evidence-'));
  const databasePath = path.join(temp, 'home-music.db');
  try {
    seedTracks(databasePath);
    const assistant = new LibraryAssistantStore(databasePath);
    assistant.createRun({
      id: 'run-same-artist',
      capability: 'metadata',
      libraryRevision: 1,
      createdAt: '2026-09-10T10:00:00.000Z'
    });
    insertMusicBrainzSuggestion(assistant, {
      runId: 'run-same-artist', suggestionId: 'suggestion-a', trackId: 'a', sourceArtist: 'Beyonce', artistId: 'artist-1'
    });
    insertMusicBrainzSuggestion(assistant, {
      runId: 'run-same-artist', suggestionId: 'suggestion-b', trackId: 'b', sourceArtist: 'Beyoncé', artistId: 'artist-1'
    });
    assistant.close();

    const normalization = new LibraryMetadataNormalizationStore(databasePath);
    const candidate = normalization.review().candidates.find(item => item.kind === 'artist') as EnrichedCandidate | undefined;
    assert.equal(candidate?.externalEvidence?.source, 'musicbrainz');
    assert.equal(candidate?.externalEvidence?.providerCanonical, 'Beyoncé');
    assert.equal(candidate?.externalEvidence?.suggestedCanonical, 'Beyoncé');
    assert.equal(candidate?.externalEvidence?.conflict, false);
    assert.deepEqual(candidate?.externalEvidence?.externalIds, ['artist:artist-1']);
    assert.ok(candidate?.externalEvidence?.reasonCodes.includes('musicbrainz.artist-canonical'));
    normalization.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('IDs MusicBrainz diferentes bloqueiam sugestão canônica sem remover o candidato local', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'home-music-normalization-evidence-'));
  const databasePath = path.join(temp, 'home-music.db');
  try {
    seedTracks(databasePath);
    const assistant = new LibraryAssistantStore(databasePath);
    assistant.createRun({
      id: 'run-conflict',
      capability: 'metadata',
      libraryRevision: 1,
      createdAt: '2026-09-10T10:00:00.000Z'
    });
    insertMusicBrainzSuggestion(assistant, {
      runId: 'run-conflict', suggestionId: 'suggestion-a', trackId: 'a', sourceArtist: 'Beyonce', artistId: 'artist-1'
    });
    insertMusicBrainzSuggestion(assistant, {
      runId: 'run-conflict', suggestionId: 'suggestion-b', trackId: 'b', sourceArtist: 'Beyoncé', artistId: 'artist-2'
    });
    assistant.close();

    const normalization = new LibraryMetadataNormalizationStore(databasePath);
    const candidate = normalization.review().candidates.find(item => item.kind === 'artist') as EnrichedCandidate | undefined;
    assert.ok(candidate, 'a heurística local deve continuar produzindo o candidato');
    assert.equal(candidate.externalEvidence?.conflict, true);
    assert.equal(candidate.externalEvidence?.suggestedCanonical, null);
    assert.deepEqual(candidate.externalEvidence?.externalIds, ['artist:artist-1', 'artist:artist-2']);
    assert.ok(candidate.externalEvidence?.reasonCodes.includes('external-id.conflict'));
    normalization.close();
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
