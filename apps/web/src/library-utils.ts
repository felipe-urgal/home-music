import type { Track } from '@home-music/shared';

export type LibraryReturnTab = 'folders' | 'playlists';
export type TrackSort =
  | 'current'
  | 'title-asc'
  | 'title-desc'
  | 'artist-asc'
  | 'artist-desc'
  | 'album-asc'
  | 'album-desc';
export type CoverFilter = 'all' | 'with-cover' | 'without-cover';
export type TrackSearchTextIndex = ReadonlyMap<string, string>;

export type TrackViewOptions = {
  normalizedQuery: string;
  format: string;
  cover: CoverFilter;
  sort: TrackSort;
};

export type FolderGroup = {
  path: string;
  name: string;
  tracks: Track[];
  artwork?: Track;
};

export type FolderView = {
  path: string;
  name: string;
  parentPath: string | null;
  breadcrumbs: Array<{ name: string; path: string }>;
  folders: FolderGroup[];
  directTracks: Track[];
  allTracks: Track[];
};

export type LibraryReturnContext = {
  selectedPlaylistName?: string | null;
  libraryTab: LibraryReturnTab;
  folderPath: string;
  folderName: string;
  query: string;
};

const libraryCollator = new Intl.Collator('pt-BR', {
  sensitivity: 'base',
  numeric: true
});

export function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function buildTrackSearchText(track: Track) {
  return normalizeSearch(
    `${track.title} ${track.artist} ${track.album} ${track.albumArtist} ${track.folder} ${track.folderPath}`
  );
}

export function matchesTrack(
  track: Track,
  normalizedQuery: string,
  normalizedSearchText?: string
) {
  if (!normalizedQuery) return true;
  return (normalizedSearchText ?? buildTrackSearchText(track)).includes(normalizedQuery);
}

export function matchesTrackView(
  track: Track,
  options: Omit<TrackViewOptions, 'sort'>,
  searchTextByTrackId?: TrackSearchTextIndex
) {
  if (!matchesTrack(track, options.normalizedQuery, searchTextByTrackId?.get(track.id))) return false;
  if (options.format !== 'all' && track.format !== options.format) return false;
  if (options.cover === 'with-cover' && !track.hasCover) return false;
  if (options.cover === 'without-cover' && track.hasCover) return false;

  return true;
}

function compareTrackText(
  a: Track,
  b: Track,
  fields: Array<keyof Pick<Track, 'title' | 'artist' | 'album' | 'albumArtist'>>
) {
  for (const field of fields) {
    const result = libraryCollator.compare(a[field], b[field]);
    if (result !== 0) return result;
  }
  return libraryCollator.compare(a.id, b.id);
}

function compareTracks(a: Track, b: Track, sort: Exclude<TrackSort, 'current'>) {
  const descending = sort.endsWith('-desc');
  const direction = descending ? -1 : 1;
  let comparison = 0;

  if (sort.startsWith('title-')) {
    comparison = compareTrackText(a, b, ['title', 'artist', 'album']);
  } else if (sort.startsWith('artist-')) {
    comparison = compareTrackText(a, b, ['artist', 'album', 'title']);
  } else {
    comparison = compareTrackText(a, b, ['album', 'albumArtist', 'title']);
  }

  return comparison * direction;
}

export function sortTracks(tracks: Track[], sort: TrackSort) {
  const result = [...tracks];
  if (sort === 'current') return result;
  result.sort((a, b) => compareTracks(a, b, sort));
  return result;
}

export function applyTrackView(
  tracks: Track[],
  options: TrackViewOptions,
  searchTextByTrackId?: TrackSearchTextIndex
) {
  const filtered = tracks.filter(track => matchesTrackView(track, options, searchTextByTrackId));
  const sort = options.sort;
  if (sort !== 'current') {
    filtered.sort((a, b) => compareTracks(a, b, sort));
  }
  return filtered;
}

export function buildLibraryReturnLabel(context: LibraryReturnContext) {
  let target = '';

  if (context.selectedPlaylistName) target = context.selectedPlaylistName;
  else if (context.libraryTab === 'folders' && context.folderPath) target = context.folderName;

  if (context.query.trim()) {
    return target ? `Voltar para busca em ${target}` : 'Voltar para resultados da busca';
  }

  return target ? `Voltar para ${target}` : 'Voltar à biblioteca';
}

function isInsideFolder(track: Track, folderPath: string) {
  if (!folderPath) return true;
  return track.folderPath === folderPath || track.folderPath.startsWith(`${folderPath}/`);
}

export function buildFolderView(tracks: Track[], folderPath = ''): FolderView {
  const normalizedPath = folderPath.replace(/^\/+|\/+$/g, '');
  const prefix = normalizedPath ? `${normalizedPath}/` : '';
  const childFolders = new Map<string, FolderGroup>();
  const directTracks: Track[] = [];
  const allTracks = tracks.filter(track => isInsideFolder(track, normalizedPath));

  for (const track of allTracks) {
    if (track.folderPath === normalizedPath) {
      directTracks.push(track);
      continue;
    }

    const remaining = track.folderPath.slice(prefix.length);
    const childName = remaining.split('/')[0];
    if (!childName) continue;
    const childPath = prefix ? `${normalizedPath}/${childName}` : childName;
    const existing = childFolders.get(childPath);

    if (existing) {
      existing.tracks.push(track);
      if (!existing.artwork?.hasCover && track.hasCover) existing.artwork = track;
    } else {
      childFolders.set(childPath, {
        path: childPath,
        name: childName,
        tracks: [track],
        artwork: track
      });
    }
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  const parentPath = parts.length ? parts.slice(0, -1).join('/') : null;
  const breadcrumbs = parts.map((part, index) => ({
    name: part,
    path: parts.slice(0, index + 1).join('/')
  }));

  return {
    path: normalizedPath,
    name: parts.at(-1) || 'Pastas',
    parentPath,
    breadcrumbs,
    folders: [...childFolders.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    directTracks,
    allTracks
  };
}

export function buildQueueContext(track: Track, contextTracks: Track[]) {
  const index = contextTracks.findIndex(item => item.id === track.id);

  if (index >= 0) {
    return { queue: contextTracks, index };
  }

  return { queue: [track, ...contextTracks], index: 0 };
}
