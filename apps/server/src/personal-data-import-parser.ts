import type { PersonalDataBundleV1, PortableTrackReferenceV1 } from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_IMPORT_LIMITS,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import { normalizeLibraryViewDefinition, normalizeLibraryViewName } from './library-views.js';
import { normalizeSmartPlaylistRule } from './smart-playlists.js';

export type PersonalDataImportValidationErrorCode =
  | 'invalid-bundle'
  | 'limit-exceeded'
  | 'payload-too-large'
  | 'unsupported-format'
  | 'unsupported-version';

export class PersonalDataImportValidationError extends Error {
  constructor(
    readonly code: PersonalDataImportValidationErrorCode,
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = 'PersonalDataImportValidationError';
  }
}

type ReferenceCounter = { total: number };

export function assertPersonalDataImportSize(byteLength: number) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    fail('invalid-bundle', '$', 'Tamanho do bundle inválido.');
  }
  if (byteLength > PERSONAL_DATA_IMPORT_LIMITS.maxBytes) {
    fail(
      'payload-too-large',
      '$',
      `Bundle excede o limite de ${PERSONAL_DATA_IMPORT_LIMITS.maxBytes} bytes.`
    );
  }
}

export function parsePortableTrackReferenceV1(
  value: unknown,
  field = '$'
): PortableTrackReferenceV1 {
  const reference = record(value, field);
  const relativePath = text(
    reference.relativePath,
    `${field}.relativePath`,
    PERSONAL_DATA_IMPORT_LIMITS.maxRelativePathLength,
    true
  );
  validateRelativePath(relativePath, `${field}.relativePath`);

  const hints = record(reference.hints, `${field}.hints`);
  text(hints.title, `${field}.hints.title`, PERSONAL_DATA_IMPORT_LIMITS.maxHintLength);
  text(hints.artist, `${field}.hints.artist`, PERSONAL_DATA_IMPORT_LIMITS.maxHintLength);
  text(hints.album, `${field}.hints.album`, PERSONAL_DATA_IMPORT_LIMITS.maxHintLength);
  if (hints.durationSeconds !== null) {
    nonNegativeNumber(hints.durationSeconds, `${field}.hints.durationSeconds`);
  }

  return value as PortableTrackReferenceV1;
}

export function parsePersonalDataBundleV1(value: unknown): PersonalDataBundleV1 {
  const bundle = record(value, '$');

  if (bundle.format !== PERSONAL_DATA_FORMAT) {
    fail('unsupported-format', '$.format', 'Formato de bundle pessoal não suportado.');
  }
  if (bundle.version !== PERSONAL_DATA_VERSION) {
    fail('unsupported-version', '$.version', 'Versão de bundle pessoal não suportada.');
  }

  isoDate(bundle.exportedAt, '$.exportedAt');
  const references: ReferenceCounter = { total: 0 };

  const favorites = array(bundle.favorites, '$.favorites', PERSONAL_DATA_IMPORT_LIMITS.maxFavorites);
  favorites.forEach((item, index) => {
    countedTrackReference(item, `$.favorites[${index}]`, references);
  });

  const manualPlaylists = array(
    bundle.manualPlaylists,
    '$.manualPlaylists',
    PERSONAL_DATA_IMPORT_LIMITS.maxManualPlaylists
  );
  manualPlaylists.forEach((value, index) => {
    const field = `$.manualPlaylists[${index}]`;
    const playlist = record(value, field);
    name(playlist.name, `${field}.name`);
    isoDate(playlist.createdAt, `${field}.createdAt`);
    isoDate(playlist.updatedAt, `${field}.updatedAt`);
    const tracks = array(
      playlist.tracks,
      `${field}.tracks`,
      PERSONAL_DATA_IMPORT_LIMITS.maxTracksPerManualPlaylist
    );
    tracks.forEach((item, trackIndex) => {
      countedTrackReference(item, `${field}.tracks[${trackIndex}]`, references);
    });
  });

  const smartPlaylists = array(
    bundle.smartPlaylists,
    '$.smartPlaylists',
    PERSONAL_DATA_IMPORT_LIMITS.maxSmartPlaylists
  );
  smartPlaylists.forEach((value, index) => {
    const field = `$.smartPlaylists[${index}]`;
    const playlist = record(value, field);
    name(playlist.name, `${field}.name`);
    if (!normalizeSmartPlaylistRule(playlist.rule)) {
      fail('invalid-bundle', `${field}.rule`, 'Regra de smart playlist inválida.');
    }
    isoDate(playlist.createdAt, `${field}.createdAt`);
    isoDate(playlist.updatedAt, `${field}.updatedAt`);
  });

  const libraryViews = array(
    bundle.libraryViews,
    '$.libraryViews',
    PERSONAL_DATA_IMPORT_LIMITS.maxLibraryViews
  );
  libraryViews.forEach((value, index) => {
    const field = `$.libraryViews[${index}]`;
    const view = record(value, field);
    if (!normalizeLibraryViewName(view.name)) {
      fail('invalid-bundle', `${field}.name`, 'Nome de view da biblioteca inválido.');
    }
    if (!normalizeLibraryViewDefinition(view.definition)) {
      fail('invalid-bundle', `${field}.definition`, 'Definição de view da biblioteca inválida.');
    }
    isoDate(view.createdAt, `${field}.createdAt`);
    isoDate(view.updatedAt, `${field}.updatedAt`);
  });

  const playbackHistory = array(
    bundle.playbackHistory,
    '$.playbackHistory',
    PERSONAL_DATA_IMPORT_LIMITS.maxPlaybackHistory
  );
  playbackHistory.forEach((value, index) => {
    const field = `$.playbackHistory[${index}]`;
    const item = record(value, field);
    countedTrackReference(item.track, `${field}.track`, references);
    isoDate(item.playedAt, `${field}.playedAt`);
  });

  const playbackState = record(bundle.playbackState, '$.playbackState');
  if (playbackState.currentTrack !== null) {
    countedTrackReference(playbackState.currentTrack, '$.playbackState.currentTrack', references);
  }
  nonNegativeNumber(playbackState.position, '$.playbackState.position');
  numberInRange(playbackState.volume, '$.playbackState.volume', 0, 1);
  boolean(playbackState.shuffle, '$.playbackState.shuffle');
  if (
    playbackState.repeatMode !== 'off'
    && playbackState.repeatMode !== 'all'
    && playbackState.repeatMode !== 'one'
  ) {
    fail('invalid-bundle', '$.playbackState.repeatMode', 'Modo de repetição inválido.');
  }
  boolean(playbackState.wasPlaying, '$.playbackState.wasPlaying');

  const baseQueue = array(
    playbackState.baseQueue,
    '$.playbackState.baseQueue',
    PERSONAL_DATA_IMPORT_LIMITS.maxQueueEntries
  );
  baseQueue.forEach((item, index) => {
    countedTrackReference(item, `$.playbackState.baseQueue[${index}]`, references);
  });

  const queue = array(
    playbackState.queue,
    '$.playbackState.queue',
    PERSONAL_DATA_IMPORT_LIMITS.maxQueueEntries
  );
  queue.forEach((item, index) => {
    countedTrackReference(item, `$.playbackState.queue[${index}]`, references);
  });
  isoDate(playbackState.updatedAt, '$.playbackState.updatedAt');

  return value as PersonalDataBundleV1;
}

function countedTrackReference(value: unknown, field: string, counter: ReferenceCounter) {
  counter.total += 1;
  if (counter.total > PERSONAL_DATA_IMPORT_LIMITS.maxTotalTrackReferences) {
    fail(
      'limit-exceeded',
      field,
      `Bundle excede o limite de ${PERSONAL_DATA_IMPORT_LIMITS.maxTotalTrackReferences} referências de faixa.`
    );
  }
  return parsePortableTrackReferenceV1(value, field);
}

function validateRelativePath(value: string, field: string) {
  if (
    value.startsWith('/')
    || /^[a-zA-Z]:/.test(value)
    || value.includes('\\')
    || value.includes('\0')
  ) {
    fail('invalid-bundle', field, 'relativePath deve ser relativo e portátil.');
  }

  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    fail('invalid-bundle', field, 'relativePath contém segmento inválido.');
  }
}

function array(value: unknown, field: string, maxItems: number): unknown[] {
  if (!Array.isArray(value)) {
    fail('invalid-bundle', field, 'Coleção esperada no bundle pessoal.');
  }
  if (value.length > maxItems) {
    fail('limit-exceeded', field, `Coleção excede o limite de ${maxItems} itens.`);
  }
  return value;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-bundle', field, 'Objeto esperado no bundle pessoal.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, maxLength: number, required = false) {
  if (typeof value !== 'string' || value.length > maxLength || (required && value.length === 0)) {
    fail('invalid-bundle', field, 'Texto inválido no bundle pessoal.');
  }
  return value;
}

function name(value: unknown, field: string) {
  const clean = text(value, field, PERSONAL_DATA_IMPORT_LIMITS.maxNameLength, true).trim();
  if (!clean) fail('invalid-bundle', field, 'Nome inválido no bundle pessoal.');
}

function isoDate(value: unknown, field: string) {
  const candidate = text(value, field, PERSONAL_DATA_IMPORT_LIMITS.maxTimestampLength, true);
  if (!Number.isFinite(Date.parse(candidate))) {
    fail('invalid-bundle', field, 'Data inválida no bundle pessoal.');
  }
}

function nonNegativeNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail('invalid-bundle', field, 'Número inválido no bundle pessoal.');
  }
}

function numberInRange(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail('invalid-bundle', field, 'Número inválido no bundle pessoal.');
  }
}

function boolean(value: unknown, field: string) {
  if (typeof value !== 'boolean') {
    fail('invalid-bundle', field, 'Booleano inválido no bundle pessoal.');
  }
}

function fail(code: PersonalDataImportValidationErrorCode, field: string, message: string): never {
  throw new PersonalDataImportValidationError(code, field, message);
}
