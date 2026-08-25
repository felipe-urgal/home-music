import { useDeferredValue, useMemo, useState } from 'react';
import type { Playlist, Track } from '@home-music/shared';
import {
  applyTrackView,
  buildFolderView,
  groupTracks,
  matchesTrackView,
  normalizeSearch,
  type CoverFilter,
  type FavoriteFilter,
  type TrackSort,
  type TrackViewOptions
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
  const [sort, setSort] = useState<TrackSort>('current');
  const [formatFilter, setFormatFilter] = useState('all');
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>('all');
  const [coverFilter, setCoverFilter] = useState<CoverFilter>('all');
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

  const playlistTracks = useMemo(
    () => selectedPlaylist
      ? selectedPlaylist.trackIds
        .map(id => trackMap.get(id))
        .filter((track): track is Track => Boolean(track))
      : [],
    [selectedPlaylist, trackMap]
  );

  const folderView = useMemo(() => buildFolderView(tracks, folderPath), [folderPath, tracks]);

  const filterScopeTracks = useMemo(() => {
    if (libraryTab === 'favorites') return tracks.filter(track => favoriteSet.has(track.id));
    if (libraryTab === 'playlists' && selectedPlaylist) return playlistTracks;
    if (selectedGroup) return selectedGroup.tracks;
    if (libraryTab === 'folders') return folderView.allTracks;
    return tracks;
  }, [favoriteSet, folderView.allTracks, libraryTab, playlistTracks, selectedGroup, selectedPlaylist, tracks]);

  const availableFormats = useMemo(
    () => [...new Set(filterScopeTracks.map(track => track.format))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [filterScopeTracks]
  );

  const viewOptions = useMemo<TrackViewOptions>(() => ({
    normalizedQuery,
    format: formatFilter,
    favorite: favoriteFilter,
    cover: coverFilter,
    sort,
    favoriteIds: favoriteSet
  }), [coverFilter, favoriteFilter, favoriteSet, formatFilter, normalizedQuery, sort]);

  const visibleGroups = useMemo(() => groups.flatMap(group => {
    const matchingTracks = group.tracks.filter(track => matchesTrackView(track, viewOptions));
    if (!matchingTracks.length) return [];
    return [{
      ...group,
      matchingTrackCount: matchingTracks.length,
      artwork: matchingTracks.find(track => track.hasCover) ?? matchingTracks[0] ?? group.artwork
    }];
  }), [groups, viewOptions]);

  const baseTracks = useMemo(() => {
    if (libraryTab === 'favorites') {
      return tracks.filter(track => favoriteSet.has(track.id));
    }
    if (libraryTab === 'playlists' && selectedPlaylist) return playlistTracks;
    if (selectedGroup) return selectedGroup.tracks;
    if (libraryTab === 'folders') return normalizedQuery ? folderView.allTracks : folderView.directTracks;
    return tracks;
  }, [favoriteSet, folderView, libraryTab, normalizedQuery, playlistTracks, selectedGroup, selectedPlaylist, tracks]);

  const libraryTracks = useMemo(
    () => applyTrackView(baseTracks, viewOptions),
    [baseTracks, viewOptions]
  );

  const folderContextTracks = useMemo(
    () => applyTrackView(folderView.allTracks, viewOptions),
    [folderView.allTracks, viewOptions]
  );

  const visibleFolders = useMemo(() => folderView.folders.flatMap(folder => {
    const matchingTracks = folder.tracks.filter(track => matchesTrackView(track, viewOptions));
    if (!matchingTracks.length) return [];
    return [{
      ...folder,
      matchingTrackCount: matchingTracks.length,
      artwork: matchingTracks.find(track => track.hasCover) ?? matchingTracks[0] ?? folder.artwork
    }];
  }), [folderView.folders, viewOptions]);

  const shouldShowTracks = libraryTab === 'tracks' ||
    libraryTab === 'favorites' ||
    Boolean(selectedGroup) ||
    Boolean(selectedPlaylist) ||
    (libraryTab === 'folders' && Boolean(normalizedQuery));

  const canSortTracks = shouldShowTracks || (libraryTab === 'folders' && Boolean(folderPath));
  const activeViewOptionCount = [
    sort !== 'current',
    formatFilter !== 'all',
    favoriteFilter !== 'all',
    coverFilter !== 'all'
  ].filter(Boolean).length;

  const pagedTracks = libraryTracks.slice(0, visibleCount);
  const pagedGroups = visibleGroups.slice(0, visibleCount);
  const pagedFolders = visibleFolders.slice(0, visibleCount);

  function resetPage() {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }

  function resetViewOptions() {
    setSort('current');
    setFormatFilter('all');
    setFavoriteFilter('all');
    setCoverFilter('all');
    resetPage();
  }

  function resetNavigationView() {
    setQuery('');
    setSort('current');
    setFormatFilter('all');
    setFavoriteFilter('all');
    setCoverFilter('all');
    resetPage();
  }

  function selectTab(tab: LibraryTab) {
    setLibraryTab(tab);
    setSelectedGroupKey(null);
    setSelectedPlaylistId(null);
    setFolderPath('');
    resetNavigationView();
  }

  function selectGroup(key: string) {
    setSelectedGroupKey(key);
    resetNavigationView();
  }

  function leaveGroup() {
    setSelectedGroupKey(null);
    resetNavigationView();
  }

  function enterFolder(path: string) {
    setFolderPath(path);
    resetNavigationView();
  }

  function leaveFolder() {
    setFolderPath(folderView.parentPath ?? '');
    resetNavigationView();
  }

  function selectPlaylist(id: string) {
    setSelectedPlaylistId(id);
    resetNavigationView();
  }

  function leavePlaylist() {
    setSelectedPlaylistId(null);
    resetNavigationView();
  }

  function changeQuery(value: string) {
    setQuery(value);
    resetPage();
  }

  function changeSort(value: TrackSort) {
    setSort(value);
    resetPage();
  }

  function changeFormatFilter(value: string) {
    setFormatFilter(value);
    resetPage();
  }

  function changeFavoriteFilter(value: FavoriteFilter) {
    setFavoriteFilter(value);
    resetPage();
  }

  function changeCoverFilter(value: CoverFilter) {
    setCoverFilter(value);
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
    sort,
    formatFilter,
    favoriteFilter,
    coverFilter,
    availableFormats,
    activeViewOptionCount,
    canSortTracks,
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
    changeSort,
    changeFormatFilter,
    changeFavoriteFilter,
    changeCoverFilter,
    resetViewOptions,
    showMore
  };
}

export type LibraryNavigation = ReturnType<typeof useLibraryNavigation>;
