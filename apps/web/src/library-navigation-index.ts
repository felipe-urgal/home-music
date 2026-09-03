import type { Track } from '@home-music/shared';
import {
  buildTrackSearchText,
  type FolderGroup,
  type FolderView
} from './library-utils';

type MutableFolderNode = {
  path: string;
  name: string;
  children: Map<string, MutableFolderNode>;
  directTracks: Track[];
  allTracks: Track[];
  formats: Set<string>;
};

export type LibraryNavigationIndexStats = {
  trackCount: number;
  searchEntryCount: number;
  indexedFolderCount: number;
  folderTrackReferences: number;
  maxFolderDepth: number;
};

export type LibraryNavigationIndex = {
  trackMap: ReadonlyMap<string, Track>;
  searchTextByTrackId: ReadonlyMap<string, string>;
  folderViews: ReadonlyMap<string, FolderView>;
  formatsByFolderPath: ReadonlyMap<string, string[]>;
  stats: LibraryNavigationIndexStats;
};

export type LibraryNavigationIndexCache = {
  revision: number;
  tracks: Track[];
  index: LibraryNavigationIndex;
};

function createFolderNode(path: string, name: string): MutableFolderNode {
  return {
    path,
    name,
    children: new Map(),
    directTracks: [],
    allTracks: [],
    formats: new Set()
  };
}

function folderMetadata(path: string) {
  const parts = path.split('/').filter(Boolean);
  return {
    name: parts.at(-1) || 'Pastas',
    parentPath: parts.length ? parts.slice(0, -1).join('/') : null,
    breadcrumbs: parts.map((part, index) => ({
      name: part,
      path: parts.slice(0, index + 1).join('/')
    }))
  };
}

function folderArtwork(tracks: Track[]) {
  return tracks.find(track => track.hasCover) ?? tracks[0];
}

function materializeFolderGroup(node: MutableFolderNode): FolderGroup {
  return {
    path: node.path,
    name: node.name,
    tracks: node.allTracks,
    artwork: folderArtwork(node.allTracks)
  };
}

export function buildLibraryNavigationIndex(tracks: Track[]): LibraryNavigationIndex {
  const trackMap = new Map<string, Track>();
  const searchTextByTrackId = new Map<string, string>();
  const root = createFolderNode('', 'Pastas');
  let maxFolderDepth = 0;

  for (const track of tracks) {
    trackMap.set(track.id, track);
    searchTextByTrackId.set(track.id, buildTrackSearchText(track));

    root.allTracks.push(track);
    root.formats.add(track.format);

    const parts = track.folderPath.split('/').filter(Boolean);
    maxFolderDepth = Math.max(maxFolderDepth, parts.length);
    let node = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let child = node.children.get(part);

      if (!child) {
        child = createFolderNode(currentPath, part);
        node.children.set(part, child);
      }

      child.allTracks.push(track);
      child.formats.add(track.format);
      node = child;
    }

    node.directTracks.push(track);
  }

  const folderViews = new Map<string, FolderView>();
  const formatsByFolderPath = new Map<string, string[]>();
  let indexedFolderCount = 0;
  let folderTrackReferences = tracks.length;

  const materialize = (node: MutableFolderNode) => {
    indexedFolderCount += 1;
    folderTrackReferences += node.allTracks.length;

    const metadata = folderMetadata(node.path);
    const children = [...node.children.values()]
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    folderViews.set(node.path, {
      path: node.path,
      name: metadata.name,
      parentPath: metadata.parentPath,
      breadcrumbs: metadata.breadcrumbs,
      folders: children.map(materializeFolderGroup),
      directTracks: node.directTracks,
      allTracks: node.allTracks
    });
    formatsByFolderPath.set(
      node.path,
      [...node.formats].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    );

    for (const child of children) materialize(child);
  };

  materialize(root);

  return {
    trackMap,
    searchTextByTrackId,
    folderViews,
    formatsByFolderPath,
    stats: {
      trackCount: tracks.length,
      searchEntryCount: searchTextByTrackId.size,
      indexedFolderCount,
      folderTrackReferences,
      maxFolderDepth
    }
  };
}

export function getIndexedFolderView(index: LibraryNavigationIndex, folderPath = ''): FolderView {
  const normalizedPath = folderPath.replace(/^\/+|\/+$/g, '');
  const indexed = index.folderViews.get(normalizedPath);
  if (indexed) return indexed;

  const metadata = folderMetadata(normalizedPath);
  return {
    path: normalizedPath,
    name: metadata.name,
    parentPath: metadata.parentPath,
    breadcrumbs: metadata.breadcrumbs,
    folders: [],
    directTracks: [],
    allTracks: []
  };
}

export function shouldRebuildLibraryNavigationIndex(
  cache: LibraryNavigationIndexCache | null,
  tracks: Track[],
  revision: number
) {
  if (!cache) return true;
  if (cache.revision !== revision) return true;
  return revision === 0 && cache.tracks !== tracks;
}
