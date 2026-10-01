import type { Playlist, Track } from '@home-music/shared';

export type DjLibrarySource = {
  value: string;
  label: string;
  group: 'all' | 'folder' | 'playlist';
};

export function buildDjLibrarySources(
  tracks: readonly Track[],
  playlists: readonly Playlist[]
): DjLibrarySource[] {
  const paths = new Set<string>();
  for (const track of tracks) {
    const parts = track.folderPath.split('/').filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      paths.add(parts.slice(0, index).join('/'));
    }
  }

  return [
    { value: 'all', label: 'Todas as faixas', group: 'all' },
    ...[...paths]
      .sort((left, right) => left.localeCompare(right, 'pt-BR'))
      .map(path => ({ value: `folder:${path}`, label: path, group: 'folder' as const })),
    ...playlists.map(playlist => ({
      value: `playlist:${playlist.id}`,
      label: playlist.name,
      group: 'playlist' as const
    }))
  ];
}

export function tracksForDjLibrarySource(
  source: string,
  tracks: readonly Track[],
  playlists: readonly Playlist[],
  tracksById: ReadonlyMap<string, Track>
): Track[] | readonly Track[] {
  if (source === 'all') return tracks;

  if (source.startsWith('folder:')) {
    const folderPath = source.slice('folder:'.length);
    const prefix = `${folderPath}/`;
    return tracks.filter(track => (
      track.folderPath === folderPath
      || track.folderPath.startsWith(prefix)
    ));
  }

  if (source.startsWith('playlist:')) {
    const playlistId = source.slice('playlist:'.length);
    const playlist = playlists.find(item => item.id === playlistId);
    if (!playlist) return [];
    return playlist.trackIds
      .map(trackId => tracksById.get(trackId))
      .filter((track): track is Track => Boolean(track));
  }

  return tracks;
}
