import type { Track } from '@home-music/shared';

export type GroupTab = 'folders' | 'artists' | 'albums';

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
