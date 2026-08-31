import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Playlist, Track } from '@home-music/shared';
import {
  libraryPathForState,
  libraryRouteFromPath,
  navigateAppPath
} from './browser-navigation';
import {
  compatibleLibraryViewDefinition,
  type LibraryViewDefinition
} from './library-view-types';
import {
  applyTrackView,
  buildFolderView,
  matchesTrackView,
  normalizeSearch,
  type CoverFilter,
  type TrackSort,
  type TrackViewOptions
} from './library-utils';

export const LIBRARY_PAGE_SIZE = 100;
export type LibraryTab = 'folders' | 'playlists';

function initialLibraryRoute() {
  if (typeof window === 'undefined') {
    return { libraryTab: 'folders' as LibraryTab, folderPath: '', selectedPlaylistId: null as string | null };
  }
  return libraryRouteFromPath(window.location.pathname)
    ?? { libraryTab: 'folders' as LibraryTab, folderPath: '', selectedPlaylistId: null as string | null };
}

export function useLibraryNavigation(
  tracks: Track[],
  playlists: Playlist[]
) {
  const initialRoute = useMemo(initialLibraryRoute, []);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>(initialRoute.libraryTab);
  const [folderPath, setFolderPath] = useState(initialRoute.folderPath);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(initialRoute.selectedPlaylistId);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TrackSort>('current');
  const [formatFilter, setFormatFilter] = useState('all');
  const [coverFilter, setCoverFilter] = useState<CoverFilter>('all');
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeSearch(deferredQuery);
  const trackMap = useMemo(() => new Map(tracks.map(track => [track.id, track])), [tracks]);

  const selectedPlaylist = useMemo(
    () => playlists.find(playlist => playlist.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId]
  );

  const routePath = useMemo(
    () => libraryPathForState({ libraryTab, folderPath, selectedPlaylistId }),
    [folderPath, libraryTab, selectedPlaylistId]
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
    if (libraryTab === 'playlists' && selectedPlaylist) return playlistTracks;
    return folderView.allTracks;
  }, [folderView.allTracks, libraryTab, playlistTracks, selectedPlaylist]);

  const availableFormats = useMemo(
    () => [...new Set(filterScopeTracks.map(track => track.format))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [filterScopeTracks]
  );

  const viewOptions = useMemo<TrackViewOptions>(() => ({
    normalizedQuery,
    format: formatFilter,
    cover: coverFilter,
    sort
  }), [coverFilter, formatFilter, normalizedQuery, sort]);

  const currentViewDefinition = useMemo<LibraryViewDefinition>(() => ({
    query: query.trim(),
    format: formatFilter,
    cover: coverFilter,
    sort
  }), [coverFilter, formatFilter, query, sort]);

  const baseTracks = useMemo(() => {
    if (libraryTab === 'playlists' && selectedPlaylist) return playlistTracks;
    return normalizedQuery ? folderView.allTracks : folderView.directTracks;
  }, [folderView, libraryTab, normalizedQuery, playlistTracks, selectedPlaylist]);

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

  const shouldShowTracks = Boolean(selectedPlaylist) ||
    (libraryTab === 'folders' && Boolean(normalizedQuery));

  const canSortTracks = shouldShowTracks || (libraryTab === 'folders' && Boolean(folderPath));
  const activeViewOptionCount = [
    sort !== 'current',
    formatFilter !== 'all',
    coverFilter !== 'all'
  ].filter(Boolean).length;

  const pagedTracks = libraryTracks.slice(0, visibleCount);
  const pagedFolders = visibleFolders.slice(0, visibleCount);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncFromHistory = () => {
      const route = libraryRouteFromPath(window.location.pathname);
      if (!route) return;
      setLibraryTab(route.libraryTab);
      setFolderPath(route.folderPath);
      setSelectedPlaylistId(route.selectedPlaylistId);
      setQuery('');
      setSort('current');
      setFormatFilter('all');
      setCoverFilter('all');
      setVisibleCount(LIBRARY_PAGE_SIZE);
    };

    window.addEventListener('popstate', syncFromHistory);
    return () => window.removeEventListener('popstate', syncFromHistory);
  }, []);

  function resetPage() {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }

  function resetViewOptions() {
    setSort('current');
    setFormatFilter('all');
    setCoverFilter('all');
    resetPage();
  }

  function resetNavigationView() {
    setQuery('');
    setSort('current');
    setFormatFilter('all');
    setCoverFilter('all');
    resetPage();
  }

  function selectTab(tab: LibraryTab) {
    setLibraryTab(tab);
    setSelectedPlaylistId(null);
    setFolderPath('');
    resetNavigationView();
    navigateAppPath(libraryPathForState({ libraryTab: tab, folderPath: '', selectedPlaylistId: null }));
  }

  function enterFolder(path: string) {
    setLibraryTab('folders');
    setSelectedPlaylistId(null);
    setFolderPath(path);
    resetNavigationView();
    navigateAppPath(libraryPathForState({ libraryTab: 'folders', folderPath: path, selectedPlaylistId: null }));
  }

  function leaveFolder() {
    const parentPath = folderView.parentPath ?? '';
    setFolderPath(parentPath);
    resetNavigationView();
    navigateAppPath(libraryPathForState({ libraryTab: 'folders', folderPath: parentPath, selectedPlaylistId: null }));
  }

  function selectPlaylist(id: string) {
    setLibraryTab('playlists');
    setFolderPath('');
    setSelectedPlaylistId(id);
    resetNavigationView();
    navigateAppPath(libraryPathForState({ libraryTab: 'playlists', folderPath: '', selectedPlaylistId: id }));
  }

  function leavePlaylist() {
    setSelectedPlaylistId(null);
    resetNavigationView();
    navigateAppPath(libraryPathForState({ libraryTab: 'playlists', folderPath: '', selectedPlaylistId: null }));
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

  function changeCoverFilter(value: CoverFilter) {
    setCoverFilter(value);
    resetPage();
  }

  function applyLibraryView(definition: LibraryViewDefinition) {
    const targetCanSort = Boolean(definition.query.trim())
      || Boolean(selectedPlaylist)
      || (libraryTab === 'folders' && Boolean(folderPath));
    const compatible = compatibleLibraryViewDefinition(
      definition,
      availableFormats,
      targetCanSort
    );
    setQuery(compatible.query);
    setSort(compatible.sort);
    setFormatFilter(compatible.format);
    setCoverFilter(compatible.cover);
    resetPage();
  }

  function showMore() {
    setVisibleCount(count => count + LIBRARY_PAGE_SIZE);
  }

  return {
    libraryTab,
    selectedPlaylistId,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    routePath,
    query,
    normalizedQuery,
    sort,
    formatFilter,
    coverFilter,
    availableFormats,
    activeViewOptionCount,
    canSortTracks,
    currentViewDefinition,
    visibleCount,
    visibleFolders,
    libraryTracks,
    shouldShowTracks,
    pagedTracks,
    pagedFolders,
    selectTab,
    enterFolder,
    leaveFolder,
    selectPlaylist,
    leavePlaylist,
    changeQuery,
    changeSort,
    changeFormatFilter,
    changeCoverFilter,
    applyLibraryView,
    resetViewOptions,
    showMore
  };
}

export type LibraryNavigation = ReturnType<typeof useLibraryNavigation>;
