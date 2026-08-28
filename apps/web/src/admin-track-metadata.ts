import type {
  EditableTrackMetadata,
  TrackMetadataOverridePatch
} from '@home-music/shared';

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

  for (const [field, value] of Object.entries(normalized)) {
    if (!value) throw new Error(`${field} não pode ficar vazio.`);
  }

  return {
    title: normalized.title === physical.title ? null : normalized.title,
    artist: normalized.artist === physical.artist ? null : normalized.artist,
    album: normalized.album === physical.album ? null : normalized.album,
    albumArtist: normalized.albumArtist === physical.albumArtist ? null : normalized.albumArtist
  };
}
