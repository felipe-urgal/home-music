import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersonalDataBundleV1, PortableTrackReferenceV1 } from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_IMPORT_LIMITS,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import { PersonalDataImportPlanner } from './personal-data-import-plan.js';
import { PersonalDataImportValidationError } from './personal-data-import-parser.js';
import type { PersonalDataTrackMatchResult } from './personal-data-track-matcher.js';

function reference(relativePath: string): PortableTrackReferenceV1 {
  return {
    relativePath,
    hints: {
      title: 'Faixa',
      artist: 'Artista',
      album: 'Álbum',
      durationSeconds: 180
    }
  };
}

function bundle(): PersonalDataBundleV1 {
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-06T12:00:00.000Z',
    favorites: [reference('Favoritas/a.mp3')],
    manualPlaylists: [{
      name: 'Manual',
      tracks: [reference('Playlist/b.mp3')],
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    smartPlaylists: [],
    libraryViews: [],
    playbackHistory: [{
      track: reference('Histórico/c.mp3'),
      playedAt: '2026-09-05T18:00:00.000Z'
    }],
    playbackState: {
      currentTrack: reference('Player/d.mp3'),
      position: 10,
      volume: 0.8,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueue: [reference('Fila/e.mp3')],
      queue: [reference('Fila/f.mp3')],
      updatedAt: '2026-09-05T18:00:00.000Z'
    }
  };
}

function found(trackId: string): PersonalDataTrackMatchResult {
  return {
    status: 'found',
    trackId,
    strategy: 'relative-path',
    reason: 'relative-path',
    candidateTrackIds: []
  };
}

function missing(reason: 'no-candidate' | 'relative-path-conflict'): PersonalDataTrackMatchResult {
  return {
    status: 'missing',
    trackId: null,
    strategy: reason === 'relative-path-conflict' ? 'relative-path' : null,
    reason,
    candidateTrackIds: reason === 'relative-path-conflict' ? ['internal-conflict-id'] : []
  };
}

function ambiguous(): PersonalDataTrackMatchResult {
  return {
    status: 'ambiguous',
    trackId: null,
    strategy: 'hints',
    reason: 'hints-ambiguous',
    candidateTrackIds: ['internal-candidate-a', 'internal-candidate-b']
  };
}

test('planner faz uma única passada de matching e separa preview público do plano interno', () => {
  const calls: PortableTrackReferenceV1[][] = [];
  const planner = new PersonalDataImportPlanner({
    matchMany(references) {
      calls.push(references as PortableTrackReferenceV1[]);
      return [
        found('internal-found-a'),
        missing('no-candidate'),
        ambiguous(),
        missing('relative-path-conflict'),
        found('internal-found-e'),
        found('internal-found-f')
      ];
    }
  });

  const plan = planner.plan(bundle());

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.map(item => item.relativePath), [
    'Favoritas/a.mp3',
    'Playlist/b.mp3',
    'Histórico/c.mp3',
    'Player/d.mp3',
    'Fila/e.mp3',
    'Fila/f.mp3'
  ]);
  assert.deepEqual(plan.preview.references, {
    total: 6,
    found: 3,
    missing: 1,
    ambiguous: 1,
    conflict: 1
  });
  assert.deepEqual(plan.preview.domains.favorites.references, {
    total: 1,
    found: 1,
    missing: 0,
    ambiguous: 0,
    conflict: 0
  });
  assert.equal(plan.preview.domains.manualPlaylists.items, 1);
  assert.equal(plan.preview.domains.manualPlaylists.references.missing, 1);
  assert.equal(plan.preview.domains.playbackHistory.references.ambiguous, 1);
  assert.equal(plan.preview.domains.playbackState.references.conflict, 1);
  assert.deepEqual(plan.preview.issues.map(issue => ({
    field: issue.field,
    status: issue.status,
    reason: issue.reason
  })), [
    {
      field: '$.manualPlaylists[0].tracks[0]',
      status: 'missing',
      reason: 'no-candidate'
    },
    {
      field: '$.playbackHistory[0].track',
      status: 'ambiguous',
      reason: 'hints-ambiguous'
    },
    {
      field: '$.playbackState.currentTrack',
      status: 'conflict',
      reason: 'relative-path-conflict'
    }
  ]);

  assert.equal(plan.references[0]?.match.trackId, 'internal-found-a');
  assert.deepEqual(plan.references[2]?.match.candidateTrackIds, [
    'internal-candidate-a',
    'internal-candidate-b'
  ]);

  const publicJson = JSON.stringify(plan.preview);
  assert.equal(publicJson.includes('internal-found-a'), false);
  assert.equal(publicJson.includes('internal-candidate-a'), false);
  assert.equal(publicJson.includes('internal-conflict-id'), false);
});

test('planner falha fechado no parser antes de chamar matching', () => {
  let matchingCalls = 0;
  const planner = new PersonalDataImportPlanner({
    matchMany() {
      matchingCalls += 1;
      return [];
    }
  });

  assert.throws(
    () => planner.plan({ ...bundle(), format: 'formato-desconhecido' }),
    error => error instanceof PersonalDataImportValidationError
      && error.code === 'unsupported-format'
  );
  assert.equal(matchingCalls, 0);
});

test('preview limita detalhes sem perder contagem total de referências não resolvidas', () => {
  const input = bundle();
  input.manualPlaylists = [];
  input.playbackHistory = [];
  input.playbackState.currentTrack = null;
  input.playbackState.baseQueue = [];
  input.playbackState.queue = [];
  input.favorites = Array.from(
    { length: PERSONAL_DATA_IMPORT_LIMITS.maxPreviewIssues + 1 },
    (_, index) => reference(`Favoritas/${index}.mp3`)
  );

  const planner = new PersonalDataImportPlanner({
    matchMany(references) {
      return references.map(() => missing('no-candidate'));
    }
  });
  const preview = planner.plan(input).preview;

  assert.equal(preview.references.total, PERSONAL_DATA_IMPORT_LIMITS.maxPreviewIssues + 1);
  assert.equal(preview.references.missing, PERSONAL_DATA_IMPORT_LIMITS.maxPreviewIssues + 1);
  assert.equal(preview.issues.length, PERSONAL_DATA_IMPORT_LIMITS.maxPreviewIssues);
  assert.equal(preview.issuesTruncated, true);
});
