import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AdminLibraryOverviewResponse, Track } from '@home-music/shared';
import type { IndexedTrack } from './library.js';
import { TrackCoverOverrideStore } from './track-cover-overrides.js';
import { TrackMetadataOverrideStore } from './track-metadata-overrides.js';

type ScannerState = AdminLibraryOverviewResponse['scanner'];

export type AdminLibraryProblemKey =
  | 'missingTitle'
  | 'missingCover'
  | 'unknownArtist'
  | 'unknownAlbum'
  | 'missingDuration';

export type AdminLibraryHealthOverviewResponse = Omit<AdminLibraryOverviewResponse, 'storage' | 'problems'> & {
  storage: AdminLibraryOverviewResponse['storage'] & {
    databaseBytes: number | null;
  };
  problems: AdminLibraryOverviewResponse['problems'] & {
    missingTitle: number;
    trackIds: Record<AdminLibraryProblemKey, string[]>;
  };
};

type AdminLibraryOverviewOptions = {
  databasePath?: string;
  databaseBytes?: number | null;
  resolveTrack?: (track: IndexedTrack) => Track;
};

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const UNKNOWN_ARTIST = 'Artista desconhecido';
const UNKNOWN_ALBUM = 'Álbum desconhecido';

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

function titleUsesScannerFallback(track: IndexedTrack) {
  const extension = path.extname(track.filePath);
  const fallbackTitle = path.basename(track.filePath, extension);
  return track.title === fallbackTitle;
}

function defaultTrackResolver(databasePath: string) {
  const metadataOverrides = new TrackMetadataOverrideStore(databasePath);
  const coverOverrides = new TrackCoverOverrideStore(databasePath);

  return {
    resolve(track: IndexedTrack) {
      return coverOverrides.resolveTrack(metadataOverrides.resolveTrack(track));
    },
    close() {
      coverOverrides.close();
      metadataOverrides.close();
    }
  };
}

export async function buildAdminLibraryOverview(
  tracks: readonly IndexedTrack[],
  scanner: ScannerState,
  options: AdminLibraryOverviewOptions = {}
): Promise<AdminLibraryHealthOverviewResponse> {
  const databasePath = options.databasePath || process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
  const databaseBytes = options.databaseBytes === undefined
    ? await databaseFootprintBytes(databasePath)
    : options.databaseBytes;
  const resolver = options.resolveTrack ? null : defaultTrackResolver(databasePath);
  const resolveTrack = options.resolveTrack ?? (track => resolver!.resolve(track));

  let libraryBytes = 0;
  let affectedTracks = 0;
  let missingTitle = 0;
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

  try {
    for (const track of tracks) {
      libraryBytes += Math.max(0, track.fileSize);
      const effectiveTrack = resolveTrack(track);

      // O scanner usa o nome do arquivo quando a tag title não existe. Se um
      // override muda o título, a pendência deixa de existir na visão efetiva.
      const trackMissingTitle = titleUsesScannerFallback(track) && effectiveTrack.title === track.title;
      const trackMissingCover = !effectiveTrack.hasCover;
      const trackUnknownArtist = effectiveTrack.artist === UNKNOWN_ARTIST;
      const trackUnknownAlbum = effectiveTrack.album === UNKNOWN_ALBUM;
      const trackMissingDuration = track.duration == null;

      if (trackMissingTitle) {
        missingTitle += 1;
        trackIds.missingTitle.push(track.id);
      }
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
  } finally {
    resolver?.close();
  }

  return {
    tracks: { total: tracks.length },
    storage: { libraryBytes, databaseBytes },
    problems: {
      affectedTracks,
      missingTitle,
      missingCover,
      unknownArtist,
      unknownAlbum,
      missingDuration,
      trackIds
    },
    scanner
  };
}
