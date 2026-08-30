import { stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';
import type {
  AdminLibraryIntegrityStatus,
  AdminLibraryOverviewResponse,
  AdminLibraryProblemKey,
  Track
} from '@home-music/shared';
import { getLibraryIntegrityStatus } from './library-integrity.js';
import type { IndexedTrack } from './library.js';

type ScannerState = AdminLibraryOverviewResponse['scanner'];
type Row = Record<string, unknown>;

type AdminLibraryOverviewOptions = {
  databasePath?: string;
  databaseBytes?: number | null;
  integrity?: AdminLibraryIntegrityStatus;
  resolveTrack?: (track: IndexedTrack) => Track;
  isTrackHidden?: (track: IndexedTrack) => boolean;
  hasTitleOverride?: (track: IndexedTrack) => boolean;
  resolveTitleTagPresent?: (track: IndexedTrack) => boolean | null | Promise<boolean | null>;
};

type MetadataOverride = {
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
};

type CachedTitleTagPresence = {
  fileSize: number;
  mtimeMs: number;
  present: boolean;
};

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const UNKNOWN_ARTIST = 'Artista desconhecido';
const UNKNOWN_ALBUM = 'Álbum desconhecido';
const TITLE_PROBE_CONCURRENCY = 4;
const titleTagPresenceCache = new Map<string, CachedTitleTagPresence>();

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

async function fileBytes(filePath: string) {
  try {
    const info = await stat(filePath);
    return info.isFile() ? Math.max(0, info.size) : 0;
  } catch {
    return 0;
  }
}

async function databaseFootprintBytes(databasePath: string) {
  const sizes = await Promise.all([
    fileBytes(databasePath),
    fileBytes(`${databasePath}-wal`),
    fileBytes(`${databasePath}-shm`)
  ]);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0 ? total : null;
}

function scannerFallbackTitle(track: IndexedTrack) {
  const extension = path.extname(track.filePath).toLowerCase();
  return path.basename(track.filePath, extension);
}

function defaultDatabaseState(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000;');

  const metadataRows = db.prepare(`
    SELECT track_id, title, artist, album, album_artist
    FROM track_metadata_overrides;
  `).all() as Row[];
  const coverRows = db.prepare('SELECT track_id FROM track_cover_overrides;').all() as Row[];
  const hiddenRows = db.prepare('SELECT track_id FROM media_quarantine;').all() as Row[];

  const metadataOverrides = new Map<string, MetadataOverride>(metadataRows.map(row => [
    stringValue(row.track_id),
    {
      title: nullableString(row.title),
      artist: nullableString(row.artist),
      album: nullableString(row.album),
      albumArtist: nullableString(row.album_artist)
    }
  ]));
  const coverOverrides = new Set(coverRows.map(row => stringValue(row.track_id)).filter(Boolean));
  const hiddenTrackIds = new Set(hiddenRows.map(row => stringValue(row.track_id)).filter(Boolean));

  return {
    resolve(track: IndexedTrack): Track {
      const override = metadataOverrides.get(track.id);
      return {
        ...track,
        title: override?.title ?? track.title,
        artist: override?.artist ?? track.artist,
        album: override?.album ?? track.album,
        albumArtist: override?.albumArtist ?? track.albumArtist,
        hasCover: track.hasCover || coverOverrides.has(track.id)
      };
    },
    hasTitleOverride(track: IndexedTrack) {
      return metadataOverrides.get(track.id)?.title != null;
    },
    isHidden(track: IndexedTrack) {
      return hiddenTrackIds.has(track.id);
    },
    close() {
      db.close();
    }
  };
}

async function readTitleTagPresent(track: IndexedTrack) {
  const cached = titleTagPresenceCache.get(track.id);
  if (cached && cached.fileSize === track.fileSize && cached.mtimeMs === track.mtimeMs) {
    return cached.present;
  }

  try {
    const metadata = await parseFile(track.filePath, { duration: false, skipCovers: true });
    const present = Boolean(metadata.common.title?.trim());
    titleTagPresenceCache.set(track.id, {
      fileSize: track.fileSize,
      mtimeMs: track.mtimeMs,
      present
    });
    return present;
  } catch {
    return null;
  }
}

async function missingTitleTrackIds(
  entries: Array<{ track: IndexedTrack; effectiveTrack: Track }>,
  hasTitleOverride: (track: IndexedTrack) => boolean,
  resolveTitleTagPresent: (track: IndexedTrack) => boolean | null | Promise<boolean | null>
) {
  const candidates = entries.filter(({ track, effectiveTrack }) =>
    !hasTitleOverride(track) &&
    effectiveTrack.title === track.title &&
    track.title === scannerFallbackTitle(track)
  );
  if (candidates.length === 0) return new Set<string>();

  const missing = new Set<string>();
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(TITLE_PROBE_CONCURRENCY, candidates.length) },
    async () => {
      while (cursor < candidates.length) {
        const index = cursor;
        cursor += 1;
        const { track } = candidates[index];
        if (await resolveTitleTagPresent(track) === false) missing.add(track.id);
      }
    }
  );
  await Promise.all(workers);
  return missing;
}

function pruneTitleTagCache(trackIds: ReadonlySet<string>) {
  for (const trackId of titleTagPresenceCache.keys()) {
    if (!trackIds.has(trackId)) titleTagPresenceCache.delete(trackId);
  }
}

export async function buildAdminLibraryOverview(
  tracks: readonly IndexedTrack[],
  scanner: ScannerState,
  options: AdminLibraryOverviewOptions = {}
): Promise<AdminLibraryOverviewResponse> {
  const databasePath = options.databasePath || process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
  const databaseBytes = options.databaseBytes === undefined
    ? await databaseFootprintBytes(databasePath)
    : options.databaseBytes;
  const databaseState = options.resolveTrack && options.isTrackHidden && options.hasTitleOverride
    ? null
    : defaultDatabaseState(databasePath);
  const resolveTrack = options.resolveTrack ?? (track => databaseState!.resolve(track));
  const isTrackHidden = options.isTrackHidden ?? (track => databaseState!.isHidden(track));
  const hasTitleOverride = options.hasTitleOverride ?? (track => databaseState!.hasTitleOverride(track));
  const resolveTitleTagPresent = options.resolveTitleTagPresent ?? readTitleTagPresent;

  try {
    const visibleTracks = tracks.filter(track => !isTrackHidden(track));
    const visibleIds = new Set(visibleTracks.map(track => track.id));
    pruneTitleTagCache(visibleIds);

    const entries = visibleTracks.map(track => ({ track, effectiveTrack: resolveTrack(track) }));
    const missingTitleIds = await missingTitleTrackIds(entries, hasTitleOverride, resolveTitleTagPresent);

    let libraryBytes = 0;
    let affectedTracks = 0;
    let missingCover = 0;
    let unknownArtist = 0;
    let unknownAlbum = 0;
    let missingDuration = 0;
    const trackIds: Record<AdminLibraryProblemKey, string[]> = {
      missingTitle: [],
      missingCover: [],
      unknownArtist: [],
      unknownAlbum: [],
      missingDuration: []
    };

    for (const { track, effectiveTrack } of entries) {
      libraryBytes += Math.max(0, track.fileSize);
      const trackMissingTitle = missingTitleIds.has(track.id);
      const trackMissingCover = !effectiveTrack.hasCover;
      const trackUnknownArtist = effectiveTrack.artist === UNKNOWN_ARTIST;
      const trackUnknownAlbum = effectiveTrack.album === UNKNOWN_ALBUM;
      const trackMissingDuration = track.duration == null;

      if (trackMissingTitle) trackIds.missingTitle.push(track.id);
      if (trackMissingCover) {
        missingCover += 1;
        trackIds.missingCover.push(track.id);
      }
      if (trackUnknownArtist) {
        unknownArtist += 1;
        trackIds.unknownArtist.push(track.id);
      }
      if (trackUnknownAlbum) {
        unknownAlbum += 1;
        trackIds.unknownAlbum.push(track.id);
      }
      if (trackMissingDuration) {
        missingDuration += 1;
        trackIds.missingDuration.push(track.id);
      }
      if (
        trackMissingTitle ||
        trackMissingCover ||
        trackUnknownArtist ||
        trackUnknownAlbum ||
        trackMissingDuration
      ) {
        affectedTracks += 1;
      }
    }

    return {
      tracks: { total: visibleTracks.length },
      storage: { libraryBytes, databaseBytes },
      problems: {
        affectedTracks,
        missingTitle: trackIds.missingTitle.length,
        missingCover,
        unknownArtist,
        unknownAlbum,
        missingDuration,
        trackIds
      },
      integrity: options.integrity ?? getLibraryIntegrityStatus(),
      scanner
    };
  } finally {
    databaseState?.close();
  }
}
