import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  buildLibraryNavigationIndex,
  getIndexedFolderView,
  shouldRebuildLibraryNavigationIndex,
  type LibraryNavigationIndexCache
} from './library-navigation-index';
import {
  applyTrackView,
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
  playlists: Playlist[],
  libraryReady: boolean,
  libraryRevision = 0
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
  const navigationIndexCache = useRef<LibraryNavigationIndexCache | null>(null);

  if (shouldRebuildLibraryNavigationIndex(navigationIndexCache.current, tracks, libraryRevision)) {
    navigationIndexCache.current = {
      revision: libraryRevision,
      tracks,
      index: buildLibraryNavigationIndex(tracks)
    };
  }

  const navigationIndex = navigationIndexCache.current.index;
  const trackMap = navigationIndex.trackMap;

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

  const folderView = useMemo(
    () => getIndexedFolderView(navigationIndex, folderPath),
    [folderPath, navigationIndex]
  );

  const availableFormats = useMemo(() => {
    if (libraryTab === 'playlists' && selectedPlaylist) {
      return [...new Set(playlistTracks.map(track => track.format))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }
    return navigationIndex.formatsByFolderPath.get(folderView.path) ?? [];
  }, [folderView.path, libraryTab, navigationIndex.formatsByFolderPath, playlistTracks, selectedPlaylist]);

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

  const folderContextTracks = useMemo(
    () => applyTrackView(folderView.allTracks, viewOptions, navigationIndex.searchTextByTrackId),
    [folderView.allTracks, navigationIndex.searchTextByTrackId, viewOptions]
  );

  const libraryTracks = useMemo(() => {
    if (baseTracks === folderView.allTracks) return folderContextTracks;
    return applyTrackView(baseTracks, viewOptions, navigationIndex.searchTextByTrackId);
  }, [baseTracks, folderContextTracks, folderView.allTracks, navigationIndex.searchTextByTrackId, viewOptions]);

  const visibleFolders = useMemo(() => {
    const hasFilter = Boolean(normalizedQuery)
      || formatFilter !== 'all'
      || coverFilter !== 'all';

    if (!hasFilter) {
      return folderView.folders.map(folder => ({
        ...folder,
        matchingTrackCount: folder.tracks.length,
        artwork: folder.artwork
      }));
    }

    const matchingTrackIds = new Set(folderContextTracks.map(track => track.id));
    return folderView.folders.flatMap(folder => {
      let matchingTrackCount = 0;
      let firstMatchingTrack: Track | undefined;
      let firstMatchingCover: Track | undefined;

      for (const track of folder.tracks) {
        if (!matchingTrackIds.has(track.id)) continue;
        matchingTrackCount += 1;
        firstMatchingTrack ??= track;
        if (!firstMatchingCover && track.hasCover) firstMatchingCover = track;
      }

      if (!matchingTrackCount) return [];
      return [{
        ...folder,
        matchingTrackCount,
        artwork: firstMatchingCover ?? firstMatchingTrack ?? folder.artwork
      }];
    });
  }, [coverFilter, folderContextTracks, folderView.folders, formatFilter, normalizedQuery]);

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

  useEffect(() => {
    if (
      !libraryReady
      || libraryTab !== 'playlists'
      || !selectedPlaylistId
      || selectedPlaylist
    ) return;

    setSelectedPlaylistId(null);
    setQuery('');
    setSort('current');
    setFormatFilter('all');
    setCoverFilter('all');
    setVisibleCount(LIBRARY_PAGE_SIZE);
    navigateAppPath('/library/playlists', { replace: true });
  }, [libraryReady, libraryTab, selectedPlaylist, selectedPlaylistId]);

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
