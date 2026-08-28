import type {
  EditableTrackMetadata,
  TrackMetadataOverridePatch
} from '@home-music/shared';

const FIELD_LABELS: Record<keyof EditableTrackMetadata, string> = {
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista do álbum'
};

export function buildTrackMetadataOverridePatch(
  physical: EditableTrackMetadata,
  draft: EditableTrackMetadata
): TrackMetadataOverridePatch {
  const normalized: EditableTrackMetadata = {
    title: draft.title.trim(),
    artist: draft.artist.trim(),
    album: draft.album.trim(),
    albumArtist: draft.albumArtist.trim()
  };

  for (const field of Object.keys(normalized) as Array<keyof EditableTrackMetadata>) {
    if (!normalized[field]) throw new Error(`${FIELD_LABELS[field]} não pode ficar vazio.`);
  }

  return {
    title: normalized.title === physical.title ? null : normalized.title,
    artist: normalized.artist === physical.artist ? null : normalized.artist,
    album: normalized.album === physical.album ? null : normalized.album,
    albumArtist: normalized.albumArtist === physical.albumArtist ? null : normalized.albumArtist
  };
}
