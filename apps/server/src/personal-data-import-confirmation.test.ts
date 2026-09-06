import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  PersonalDataBundleV1,
  PersonalDataImportPreviewV1,
  PortableTrackReferenceV1
} from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import { personalDataImportConfirmationToken } from './personal-data-import-confirmation.js';
import type { PersonalDataImportPlan } from './personal-data-import-plan.js';

function reference(): PortableTrackReferenceV1 {
  return {
    relativePath: 'Artista/Album/faixa.mp3',
    hints: {
      title: 'Faixa',
      artist: 'Artista',
      album: 'Album',
      durationSeconds: 180
    }
  };
}

function bundle(): PersonalDataBundleV1 {
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-06T12:00:00.000Z',
    favorites: [reference()],
    manualPlaylists: [],
    smartPlaylists: [],
    libraryViews: [],
    playbackHistory: [],
    playbackState: {
      currentTrack: null,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueue: [],
      queue: [],
      updatedAt: '2026-09-06T12:00:00.000Z'
    }
  };
}

function emptyPreview(value: PersonalDataBundleV1): PersonalDataImportPreviewV1 {
  const counts = { total: 1, found: 1, missing: 0, ambiguous: 0, conflict: 0 };
  const empty = { total: 0, found: 0, missing: 0, ambiguous: 0, conflict: 0 };
  return {
    format: value.format,
    version: value.version,
    exportedAt: value.exportedAt,
    references: counts,
    domains: {
      favorites: { items: 1, references: counts },
      manualPlaylists: { items: 0, references: empty },
      smartPlaylists: { items: 0 },
      libraryViews: { items: 0 },
      playbackHistory: { items: 0, references: empty },
      playbackState: { references: empty }
    },
    issues: [],
    issuesTruncated: false
  };
}

function plan(trackId = 'track-a'): PersonalDataImportPlan {
  const value = bundle();
  return {
    bundle: value,
    references: [{
      domain: 'favorites',
      field: '$.favorites[0]',
      location: { kind: 'favorite', index: 0 },
      reference: value.favorites[0]!,
      match: {
        status: 'found',
        trackId,
        strategy: 'relative-path',
        reason: 'relative-path',
        candidateTrackIds: []
      }
    }],
    preview: emptyPreview(value)
  };
}

test('confirmation token é estável para o mesmo usuário e plano', () => {
  const current = plan();
  const first = personalDataImportConfirmationToken('user-a', current);
  const second = personalDataImportConfirmationToken('user-a', current);
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('confirmation token muda com usuário, bundle ou resultado de matching', () => {
  const current = plan();
  const baseline = personalDataImportConfirmationToken('user-a', current);
  assert.notEqual(
    personalDataImportConfirmationToken('user-b', current),
    baseline
  );
  assert.notEqual(
    personalDataImportConfirmationToken('user-a', plan('track-b')),
    baseline
  );

  const changed = plan();
  changed.bundle.playbackState.volume = 0.5;
  assert.notEqual(
    personalDataImportConfirmationToken('user-a', changed),
    baseline
  );
});
