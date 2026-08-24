import { useDeferredValue, useMemo, useState } from 'react';
import type { Playlist, Track } from '@home-music/shared';
import {
  buildFolderView,
  groupTracks,
  matchesTrack,
  normalizeSearch
} from './library-utils';

export const LIBRARY_PAGE_SIZE = 100;
export type LibraryTab = 'folders' | 'artists' | 'albums' | 'tracks' | 'favorites' | 'history' | 'playlists';

export function useLibraryNavigation(
  tracks: Track[],
  favoriteIds: string[],
  playlists: Playlist[]
) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('folders');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeSearch(deferredQuery);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const trackMap = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);

  const groups = useMemo(() => {
    if (libraryTab !== 'artists' && libraryTab !== 'albums') return [];
    return groupTracks(tracks, libraryTab);
  }, [libraryTab, tracks]);

  const selectedGroup = useMemo(
    () => groups.find(group => group.key === selectedGroupKey) ?? null,
    [groups, selectedGroupKey]
  );

  const selectedPlaylist = useMemo(
    () => playlists.find(playlist => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId]
  );

  const folderView = useMemo(() => buildFolderView(tracks, folderPath), [folderPath, tracks]);

  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return groups;
    return groups.filter(group =>
      normalizeSearch(`${group.name} ${group.subtitle ?? ''}`).includes(normalizedQuery) ||
      group.tracks.some(track => matchesTrack(track, normalizedQuery))
    );
  }, [groups, normalizedQuery]);

  const libraryTracks = useMemo(() => {
    let source: Track[];

    if (libraryTab === 'favorites') {
      source = tracks.filter(track => favoriteSet.has(track.id));
    } else if (libraryTab === 'playlists' && selectedPlaylist) {
      source = selectedPlaylist.trackIds
        .map(id => trackMap.get(id))
        .filter((track): track is Track => Boolean(track));
    } else if (selectedGroup) {
      source = selectedGroup.tracks;
    } else if (libraryTab === 'folders') {
      source = normalizedQuery ? folderView.allTracks : folderView.directTracks;
    } else {
      source = tracks;
    }

    return source.filter(track => matchesTrack(track, normalizedQuery));
  }, [favoriteSet, folderView, libraryTab, normalizedQuery, selectedGroup, selectedPlaylist, trackMap, tracks]);

  const folderContextTracks = useMemo(
    () => folderView.allTracks.filter(track => matchesTrack(track, normalizedQuery)),
    [folderView.allTracks, normalizedQuery]
  );

  const visibleFolders = useMemo(() => {
    if (!normalizedQuery) return folderView.folders;
    return folderView.folders.filter(folder =>
      normalizeSearch(folder.name).includes(normalizedQuery) ||
      folder.tracks.some(track => matchesTrack(track, normalizedQuery))
    );
  }, [folderView.folders, normalizedQuery]);

  const shouldShowTracks = libraryTab === 'tracks' ||
    libraryTab === 'favorites' ||
    Boolean(selectedGroup) ||
    Boolean(selectedPlaylist) ||
    (libraryTab === 'folders' && Boolean(normalizedQuery));

  const pagedTracks = libraryTracks.slice(0, visibleCount);
  const pagedGroups = visibleGroups.slice(0, visibleCount);
  const pagedFolders = visibleFolders.slice(0, visibleCount);

  function resetPage() {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }

  function selectTab(tab: LibraryTab) {
    setLibraryTab(tab);
    setSelectedGroupKey(null);
    setSelectedPlaylistId(null);
    setFolderPath('');
    setQuery('');
    resetPage();
  }

  function selectGroup(key: string) {
    setSelectedGroupKey(key);
    setQuery('');
    resetPage();
  }

  function leaveGroup() {
    setSelectedGroupKey(null);
    setQuery('');
    resetPage();
  }

  function enterFolder(path: string) {
    setFolderPath(path);
    setQuery('');
    resetPage();
  }

  function leaveFolder() {
    setFolderPath(folderView.parentPath ?? '');
    setQuery('');
    resetPage();
  }

  function selectPlaylist(id: string) {
    setSelectedPlaylistId(id);
    setQuery('');
    resetPage();
  }

  function leavePlaylist() {
    setSelectedPlaylistId(null);
    setQuery('');
    resetPage();
  }

  function changeQuery(value: string) {
    setQuery(value);
    resetPage();
  }

  function showMore() {
    setVisibleCount(count => count + LIBRARY_PAGE_SIZE);
  }

  return {
    libraryTab,
    selectedGroup,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    query,
    normalizedQuery,
    visibleCount,
    visibleGroups,
    visibleFolders,
    libraryTracks,
    shouldShowTracks,
    pagedTracks,
    pagedGroups,
    pagedFolders,
    selectTab,
    selectGroup,
    leaveGroup,
    enterFolder,
    leaveFolder,
    selectPlaylist,
    leavePlaylist,
    changeQuery,
    showMore
  };
}

export type LibraryNavigation = ReturnType<typeof useLibraryNavigation>;
