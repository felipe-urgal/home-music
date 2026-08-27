import type { AdminLibraryOverviewResponse } from '@home-music/shared';
import type { IndexedTrack } from './library.js';

type ScannerState = AdminLibraryOverviewResponse['scanner'];

export function buildAdminLibraryOverview(
  tracks: readonly IndexedTrack[],
  scanner: ScannerState
): AdminLibraryOverviewResponse {
  let libraryBytes = 0;
  let affectedTracks = 0;
  let missingCover = 0;
  let unknownArtist = 0;
  let unknownAlbum = 0;
  let missingDuration = 0;

  for (const track of tracks) {
    libraryBytes += Math.max(0, track.fileSize);

    const trackMissingCover = !track.hasCover;
    const trackUnknownArtist = track.artist === 'Artista desconhecido';
    const trackUnknownAlbum = track.album === 'Álbum desconhecido';
    const trackMissingDuration = track.duration == null;

    if (trackMissingCover) missingCover += 1;
    if (trackUnknownArtist) unknownArtist += 1;
    if (trackUnknownAlbum) unknownAlbum += 1;
    if (trackMissingDuration) missingDuration += 1;
    if (trackMissingCover || trackUnknownArtist || trackUnknownAlbum || trackMissingDuration) {
      affectedTracks += 1;
    }
  }

  return {
    tracks: { total: tracks.length },
    storage: { libraryBytes },
    problems: {
      affectedTracks,
      missingCover,
      unknownArtist,
      unknownAlbum,
      missingDuration
    },
    scanner
  };
}
