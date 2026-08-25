import type { Track } from '@home-music/shared';

export type GroupTab = 'folders' | 'artists' | 'albums';
export type LibraryReturnTab = 'folders' | 'artists' | 'albums' | 'tracks' | 'favorites' | 'history' | 'playlists';
export type TrackSort =
  | 'current'
  | 'title-asc'
  | 'title-desc'
  | 'artist-asc'
  | 'artist-desc'
  | 'album-asc'
  | 'album-desc';
export type FavoriteFilter = 'all' | 'favorites' | 'not-favorites';
export type CoverFilter = 'all' | 'with-cover' | 'without-cover';

export type TrackViewOptions = {
  normalizedQuery: string;
  format: string;
  favorite: FavoriteFilter;
  cover: CoverFilter;
  sort: TrackSort;
  favoriteIds: ReadonlySet<string>;
};

export type LibraryGroup = {
  key: string;
  name: string;
  subtitle?: string;
  tracks: Track[];
  artwork?: Track;
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
  selectedGroupName?: string | null;
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

export function normalizeIdentity(value: string) {
  return value
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function matchesTrack(track: Track, normalizedQuery: string) {
  if (!normalizedQuery) return true;

  return normalizeSearch(
    `${track.title} ${track.artist} ${track.album} ${track.albumArtist} ${track.folder} ${track.folderPath}`
  ).includes(normalizedQuery);
}

export function matchesTrackView(track: Track, options: Omit<TrackViewOptions, 'sort'>) {
  if (!matchesTrack(track, options.normalizedQuery)) return false;
  if (options.format !== 'all' && track.format !== options.format) return false;

  const favorite = options.favoriteIds.has(track.id);
  if (options.favorite === 'favorites' && !favorite) return false;
  if (options.favorite === 'not-favorites' && favorite) return false;
  if (options.cover === 'with-cover' && !track.hasCover) return false;
  if (options.cover === 'without-cover' && track.hasCover) return false;

  return true;
}

function compareTrackText(a: Track, b: Track, fields: Array<keyof Pick<Track, 'title' | 'artist' | 'album' | 'albumArtist'>>) {
  for (const field of fields) {
    const result = libraryCollator.compare(a[field], b[field]);
    if (result !== 0) return result;
  }
  return libraryCollator.compare(a.id, b.id);
}

export function sortTracks(tracks: Track[], sort: TrackSort) {
  const result = [...tracks];
  if (sort === 'current') return result;

  const descending = sort.endsWith('-desc');
  const direction = descending ? -1 : 1;

  result.sort((a, b) => {
    let comparison = 0;
    if (sort.startsWith('title-')) {
      comparison = compareTrackText(a, b, ['title', 'artist', 'album']);
    } else if (sort.startsWith('artist-')) {
      comparison = compareTrackText(a, b, ['artist', 'album', 'title']);
    } else {
      comparison = compareTrackText(a, b, ['album', 'albumArtist', 'title']);
    }
    return comparison * direction;
  });

  return result;
}

export function applyTrackView(tracks: Track[], options: TrackViewOptions) {
  const filtered = tracks.filter(track => matchesTrackView(track, options));
  return sortTracks(filtered, options.sort);
}

export function buildLibraryReturnLabel(context: LibraryReturnContext) {
  let target = '';

  if (context.selectedGroupName) target = context.selectedGroupName;
  else if (context.selectedPlaylistName) target = context.selectedPlaylistName;
  else if (context.libraryTab === 'folders' && context.folderPath) target = context.folderName;
  else if (context.libraryTab === 'favorites') target = 'Favoritos';
  else if (context.libraryTab === 'history') target = 'Histórico';

  if (context.query.trim()) {
    return target ? `Voltar para busca em ${target}` : 'Voltar para resultados da busca';
  }

  return target ? `Voltar para ${target}` : 'Voltar à biblioteca';
}

function groupIdentity(track: Track, tab: GroupTab) {
  if (tab === 'folders') {
    const name = track.folder || 'Sem pasta';
    return { key: `folder:${normalizeIdentity(name)}`, name };
  }

  if (tab === 'artists') {
    const name = track.artist || 'Artista desconhecido';
    return { key: `artist:${normalizeIdentity(name)}`, name };
  }

  const name = track.album || 'Álbum desconhecido';
  const subtitle = track.albumArtist || track.artist || 'Artista desconhecido';
  return {
    key: `album:${normalizeIdentity(subtitle)}\u001f${normalizeIdentity(name)}`,
    name,
    subtitle
  };
}

export function groupTracks(tracks: Track[], tab: GroupTab) {
  const groups = new Map<string, LibraryGroup>();

  for (const track of tracks) {
    const identity = groupIdentity(track, tab);
    const existing = groups.get(identity.key);

    if (existing) {
      existing.tracks.push(track);
      if (!existing.artwork?.hasCover && track.hasCover) existing.artwork = track;
      continue;
    }

    groups.set(identity.key, {
      ...identity,
      tracks: [track],
      artwork: track
    });
  }

  return [...groups.values()].sort((a, b) => {
    const nameOrder = a.name.localeCompare(b.name, 'pt-BR');
    if (nameOrder !== 0) return nameOrder;
    return (a.subtitle ?? '').localeCompare(b.subtitle ?? '', 'pt-BR');
  });
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
