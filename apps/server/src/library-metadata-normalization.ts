import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdminLibraryNormalizationAssociateRequest,
  AdminLibraryNormalizationReviewResponse,
  LibraryMetadataAlias,
  LibraryMetadataAliasKind,
  LibraryMetadataNormalizationCandidate,
  Track
} from '@home-music/shared';

const MAX_METADATA_LENGTH = 240;

type Row = Record<string, unknown>;
type AliasableMetadataTrack = Pick<Track, 'id' | 'artist' | 'album' | 'albumArtist'>;
type EffectiveMetadataTrack = AliasableMetadataTrack & Pick<Track, 'title'>;

type AliasMaps = {
  artist: Map<string, string>;
  album: Map<string, Map<string, string>>;
};

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableScope(value: unknown) {
  const scope = stringValue(value);
  return scope.trim() ? scope : null;
}

function validatedMetadataValue(value: unknown, label: string) {
  if (typeof value !== 'string') throw new TypeError(`${label} inválido.`);
  if (!value.trim()) throw new RangeError(`${label} não pode ficar vazio.`);
  if (value.length > MAX_METADATA_LENGTH) {
    throw new RangeError(`${label} deve ter no máximo ${MAX_METADATA_LENGTH} caracteres.`);
  }
  return value;
}

export function normalizationComparisonKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function aliasFromRow(row: Row): LibraryMetadataAlias {
  return {
    id: stringValue(row.id),
    kind: row.kind === 'album' ? 'album' : 'artist',
    scope: nullableScope(row.scope),
    sourceValue: stringValue(row.source_value),
    canonicalValue: stringValue(row.canonical_value),
    createdAt: stringValue(row.created_at),
    updatedAt: stringValue(row.updated_at)
  };
}

function buildAliasMaps(aliases: LibraryMetadataAlias[]): AliasMaps {
  const artist = new Map<string, string>();
  const album = new Map<string, Map<string, string>>();
  for (const alias of aliases) {
    if (alias.kind === 'artist') {
      artist.set(alias.sourceValue, alias.canonicalValue);
      continue;
    }
    if (!alias.scope) continue;
    const bySource = album.get(alias.scope) ?? new Map<string, string>();
    bySource.set(alias.sourceValue, alias.canonicalValue);
    album.set(alias.scope, bySource);
  }
  return { artist, album };
}

function resolveWithMaps<T extends AliasableMetadataTrack>(track: T, maps: AliasMaps): T {
  const artist = maps.artist.get(track.artist) ?? track.artist;
  const albumArtist = maps.artist.get(track.albumArtist) ?? track.albumArtist;
  const album = maps.album.get(albumArtist)?.get(track.album) ?? track.album;
  if (artist === track.artist && albumArtist === track.albumArtist && album === track.album) return track;
  return { ...track, artist, albumArtist, album };
}

function spacingPenalty(value: string) {
  return value === value.trim().replace(/\s+/g, ' ') ? 0 : 1;
}

function candidateGroups(kind: LibraryMetadataAliasKind, tracks: AliasableMetadataTrack[]) {
  const groups = new Map<string, Map<string, Set<string>>>();

  function add(scope: string, value: string, trackId: string) {
    const comparison = normalizationComparisonKey(value);
    if (!comparison) return;
    const key = `${scope}\u0000${comparison}`;
    const variants = groups.get(key) ?? new Map<string, Set<string>>();
    const ids = variants.get(value) ?? new Set<string>();
    ids.add(trackId);
    variants.set(value, ids);
    groups.set(key, variants);
  }

  for (const track of tracks) {
    if (kind === 'artist') {
      add('', track.artist, track.id);
      add('', track.albumArtist, track.id);
    } else {
      add(track.albumArtist, track.album, track.id);
    }
  }

  const candidates: LibraryMetadataNormalizationCandidate[] = [];
  for (const [rawKey, variants] of groups) {
    if (variants.size < 2) continue;
    const separator = rawKey.indexOf('\u0000');
    const scope = rawKey.slice(0, separator);
    const comparison = rawKey.slice(separator + 1);
    candidates.push({
      key: JSON.stringify([kind, scope, comparison]),
      kind,
      scope: kind === 'album' ? scope : null,
      variants: [...variants.entries()]
        .map(([value, ids]) => ({ value, trackCount: ids.size }))
        .sort((left, right) =>
          right.trackCount - left.trackCount
          || spacingPenalty(left.value) - spacingPenalty(right.value)
          || left.value.localeCompare(right.value, 'pt-BR')
        )
    });
  }

  return candidates.sort((left, right) =>
    (left.scope ?? '').localeCompare(right.scope ?? '', 'pt-BR')
    || left.variants[0].value.localeCompare(right.variants[0].value, 'pt-BR')
  );
}

export class LibraryMetadataNormalizationStore {
  private readonly db: DatabaseSync;
  private aliases: LibraryMetadataAlias[] = [];
  private maps: AliasMaps = { artist: new Map(), album: new Map() };

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_metadata_aliases (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('artist', 'album')),
        scope TEXT NOT NULL DEFAULT '',
        source_value TEXT NOT NULL CHECK(length(trim(source_value)) BETWEEN 1 AND ${MAX_METADATA_LENGTH}),
        canonical_value TEXT NOT NULL CHECK(length(trim(canonical_value)) BETWEEN 1 AND ${MAX_METADATA_LENGTH}),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK(source_value <> canonical_value),
        CHECK((kind = 'artist' AND scope = '') OR (kind = 'album' AND length(trim(scope)) BETWEEN 1 AND ${MAX_METADATA_LENGTH})),
        UNIQUE(kind, scope, source_value)
      );

      CREATE INDEX IF NOT EXISTS idx_library_metadata_aliases_kind_scope
      ON library_metadata_aliases(kind, scope, canonical_value);
    `);
    this.refresh();
  }

  close() {
    this.db.close();
  }

  refresh() {
    this.aliases = (this.db.prepare(`
      SELECT id, kind, scope, source_value, canonical_value, created_at, updated_at
      FROM library_metadata_aliases
      ORDER BY kind, scope COLLATE NOCASE, canonical_value COLLATE NOCASE, source_value COLLATE NOCASE;
    `).all() as Row[]).map(aliasFromRow);
    this.maps = buildAliasMaps(this.aliases);
  }

  listAliases() {
    return this.aliases.map(alias => ({ ...alias }));
  }

  resolveTrack<T extends AliasableMetadataTrack>(track: T): T {
    return resolveWithMaps(track, this.maps);
  }

  private hasMetadataOverrides() {
    return Boolean(this.db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'track_metadata_overrides'
      LIMIT 1;
    `).get());
  }

  private loadEffectiveTracksBeforeAliases(): EffectiveMetadataTrack[] {
    const hasOverrides = this.hasMetadataOverrides();
    const overrideJoin = hasOverrides
      ? 'LEFT JOIN track_metadata_overrides o ON o.track_id = t.id'
      : '';
    const titleTitle = hasOverrides ? 'COALESCE(o.title, t.title)' : 't.title';
    const titleArtist = hasOverrides ? 'COALESCE(o.artist, t.artist)' : 't.artist';
    const titleAlbum = hasOverrides ? 'COALESCE(o.album, t.album)' : 't.album';
    const titleAlbumArtist = hasOverrides ? 'COALESCE(o.album_artist, t.album_artist)' : 't.album_artist';
    const rows = this.db.prepare(`
      SELECT t.id,
             ${titleTitle} AS title,
             ${titleArtist} AS artist,
             ${titleAlbum} AS album,
             ${titleAlbumArtist} AS album_artist
      FROM tracks t
      ${overrideJoin};
    `).all() as Row[];
    return rows.map(row => ({
      id: stringValue(row.id),
      title: stringValue(row.title),
      artist: stringValue(row.artist),
      album: stringValue(row.album),
      albumArtist: stringValue(row.album_artist)
    }));
  }

  canonicalMetadataByTrackId() {
    this.refresh();
    return new Map(
      this.loadEffectiveTracksBeforeAliases().map(track => {
        const canonical = this.resolveTrack(track);
        return [canonical.id, canonical] as const;
      })
    );
  }

  review(now = new Date()): AdminLibraryNormalizationReviewResponse {
    this.refresh();
    const tracks = this.loadEffectiveTracksBeforeAliases().map(track => this.resolveTrack(track));
    const artistCandidates = candidateGroups('artist', tracks);
    const albumCandidates = candidateGroups('album', tracks);
    return {
      checkedAt: now.toISOString(),
      counts: {
        artistCandidates: artistCandidates.length,
        albumCandidates: albumCandidates.length,
        aliases: this.aliases.length
      },
      aliases: this.listAliases(),
      candidates: [...artistCandidates, ...albumCandidates]
    };
  }

  associate(input: AdminLibraryNormalizationAssociateRequest) {
    if (!input || (input.kind !== 'artist' && input.kind !== 'album')) {
      throw new TypeError('Tipo de normalização inválido.');
    }
    const canonicalValue = validatedMetadataValue(
      input.canonicalValue,
      input.kind === 'artist' ? 'Artista canônico' : 'Álbum canônico'
    );
    const scope = input.kind === 'album'
      ? validatedMetadataValue(input.scope, 'Artista do álbum')
      : '';
    if (!Array.isArray(input.sourceValues) || input.sourceValues.length === 0 || input.sourceValues.length > 50) {
      throw new TypeError('Informe de 1 a 50 variações para associar.');
    }
    const sourceValues = [...new Set(input.sourceValues.map(value => validatedMetadataValue(value, 'Variação')))]
      .filter(value => value !== canonicalValue);
    if (sourceValues.length === 0) throw new RangeError('A associação precisa ter ao menos uma variação diferente do nome canônico.');

    const comparisonKey = normalizationComparisonKey(canonicalValue);
    if (sourceValues.some(value => normalizationComparisonKey(value) !== comparisonKey)) {
      throw new RangeError('A associação foi bloqueada porque as grafias não são equivalentes pela heurística conservadora.');
    }

    // O lock de escrita cobre a revalidação e o insert para que outro admin
    // não possa alterar aliases/overrides entre a decisão e o commit.
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.refresh();
      const currentTracks = this.loadEffectiveTracksBeforeAliases().map(track => this.resolveTrack(track));
      const observed = new Set<string>();
      for (const track of currentTracks) {
        if (input.kind === 'artist') {
          observed.add(track.artist);
          observed.add(track.albumArtist);
        } else if (track.albumArtist === scope) {
          observed.add(track.album);
        }
      }
      if (!observed.has(canonicalValue) || sourceValues.some(value => !observed.has(value))) {
        throw new RangeError('A associação foi bloqueada porque uma das grafias não está mais presente na biblioteca atual.');
      }

      const existing = this.aliases.filter(alias => alias.kind === input.kind && (alias.scope ?? '') === scope);
      const sourceSet = new Set(sourceValues);
      if (existing.some(alias => sourceSet.has(alias.sourceValue))) {
        throw new RangeError('Uma das grafias já possui uma associação. Desfaça a associação atual antes de alterar o destino.');
      }
      if (existing.some(alias => alias.sourceValue === canonicalValue)) {
        throw new RangeError('O nome canônico já aponta para outra grafia. Desfaça essa associação antes de reutilizá-lo.');
      }
      if (existing.some(alias => sourceSet.has(alias.canonicalValue))) {
        throw new RangeError('A associação criaria uma cadeia de aliases. Use diretamente a grafia canônica existente.');
      }

      const now = new Date().toISOString();
      const insert = this.db.prepare(`
        INSERT INTO library_metadata_aliases(
          id, kind, scope, source_value, canonical_value, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);
      `);
      for (const sourceValue of sourceValues) {
        insert.run(randomUUID(), input.kind, scope, sourceValue, canonicalValue, now, now);
      }
      this.db.exec('COMMIT;');
      this.refresh();
      return this.listAliases();
    } catch (error) {
      try { this.db.exec('ROLLBACK;'); } catch { /* preserva erro original */ }
      throw error;
    }
  }

  remove(id: string) {
    const cleanId = typeof id === 'string' ? id.trim() : '';
    if (!cleanId || cleanId.length > 128) throw new TypeError('Associação inválida.');
    const result = this.db.prepare('DELETE FROM library_metadata_aliases WHERE id = ?;').run(cleanId);
    if (Number(result.changes) === 0) return false;
    this.refresh();
    return true;
  }
}
