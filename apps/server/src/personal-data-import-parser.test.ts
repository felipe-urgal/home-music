import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersonalDataBundleV1, PortableTrackReferenceV1 } from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_HISTORY_LIMIT,
  PERSONAL_DATA_IMPORT_LIMITS,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import {
  assertPersonalDataImportSize,
  parsePersonalDataBundleV1,
  PersonalDataImportValidationError
} from './personal-data-import-parser.js';

function reference(path = 'Artista/Álbum/faixa.mp3'): PortableTrackReferenceV1 {
  return {
    relativePath: path,
    hints: {
      title: 'Faixa',
      artist: 'Artista',
      album: 'Álbum',
      durationSeconds: 180
    }
  };
}

function bundle(): PersonalDataBundleV1 {
  const track = reference();
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-06T12:00:00.000Z',
    favorites: [track],
    manualPlaylists: [{
      name: 'Favoritas para viagem',
      tracks: [track],
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    smartPlaylists: [{
      name: 'Nunca tocadas',
      rule: {
        artist: null,
        album: null,
        folderPath: null,
        favorite: null,
        history: 'never',
        periodDays: null,
        sort: 'title',
        limit: 50
      },
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    libraryViews: [{
      name: 'Sem capa',
      definition: {
        query: '',
        format: 'Todos',
        cover: 'without-cover',
        sort: 'current'
      },
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z'
    }],
    playbackHistory: [{
      track,
      playedAt: '2026-09-05T18:00:00.000Z'
    }],
    playbackState: {
      currentTrack: track,
      position: 42,
      volume: 0.7,
      shuffle: true,
      repeatMode: 'all',
      wasPlaying: false,
      baseQueue: [track],
      queue: [track],
      updatedAt: '2026-09-05T18:00:00.000Z'
    }
  };
}

function expectValidationError(
  run: () => unknown,
  code: PersonalDataImportValidationError['code'],
  field?: string
) {
  assert.throws(run, error => {
    assert.ok(error instanceof PersonalDataImportValidationError);
    assert.equal(error.code, code);
    if (field) assert.equal(error.field, field);
    return true;
  });
}

test('parser aceita exatamente o bundle portátil v1 e não o reescreve', () => {
  const input = bundle();
  const parsed = parsePersonalDataBundleV1(input);
  assert.equal(parsed, input);
  assert.equal(parsed.format, PERSONAL_DATA_FORMAT);
  assert.equal(parsed.version, PERSONAL_DATA_VERSION);
});

test('parser rejeita formato e versão desconhecidos de forma explícita', () => {
  expectValidationError(
    () => parsePersonalDataBundleV1({ ...bundle(), format: 'outro-formato' }),
    'unsupported-format',
    '$.format'
  );
  expectValidationError(
    () => parsePersonalDataBundleV1({ ...bundle(), version: 2 }),
    'unsupported-version',
    '$.version'
  );
});

test('parser rejeita relativePath absoluto, traversal e separador não portátil', () => {
  for (const invalidPath of [
    '/music/faixa.mp3',
    '../fora.mp3',
    'Artista/../fora.mp3',
    'C:/Music/faixa.mp3',
    'Artista\\faixa.mp3'
  ]) {
    const input = bundle();
    input.favorites = [reference(invalidPath)];
    expectValidationError(
      () => parsePersonalDataBundleV1(input),
      'invalid-bundle',
      '$.favorites[0].relativePath'
    );
  }
});

test('parser valida regras e views usando as mesmas autoridades do domínio', () => {
  const invalidRule = bundle();
  invalidRule.smartPlaylists[0]!.rule.limit = 0;
  expectValidationError(
    () => parsePersonalDataBundleV1(invalidRule),
    'invalid-bundle',
    '$.smartPlaylists[0].rule'
  );

  const invalidView = bundle();
  invalidView.libraryViews[0]!.definition.cover = 'all';
  invalidView.libraryViews[0]!.definition.format = '';
  expectValidationError(
    () => parsePersonalDataBundleV1(invalidView),
    'invalid-bundle',
    '$.libraryViews[0].definition'
  );
});

test('parser rejeita coleções além dos limites antes do matching', () => {
  const input = bundle();
  input.playbackHistory = Array.from(
    { length: PERSONAL_DATA_HISTORY_LIMIT + 1 },
    (_, index) => ({
      track: reference(`Faixas/${index}.mp3`),
      playedAt: '2026-09-05T18:00:00.000Z'
    })
  );
  expectValidationError(
    () => parsePersonalDataBundleV1(input),
    'limit-exceeded',
    '$.playbackHistory'
  );
});

test('limite de bytes é verificado separadamente para o boundary HTTP', () => {
  assert.doesNotThrow(() => assertPersonalDataImportSize(PERSONAL_DATA_IMPORT_LIMITS.maxBytes));
  expectValidationError(
    () => assertPersonalDataImportSize(PERSONAL_DATA_IMPORT_LIMITS.maxBytes + 1),
    'payload-too-large',
    '$'
  );
});
