import { useDeferredValue, useMemo, useState } from 'react';
import type { Playlist, Track } from '@home-music/shared';
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

export function useLibraryNavigation(
  tracks: Track[],
  playlists: Playlist[]
) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('folders');
  const [folderPath, setFolderPath] = useState('');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
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

  function changeCoverFilter(value: CoverFilter) {
    setCoverFilter(value);
    resetPage();
  }

  function showMore() {
    setVisibleCount(count => count + LIBRARY_PAGE_SIZE);
  }

  return {
    libraryTab,
    selectedPlaylist,
    folderPath,
    folderView,
    folderContextTracks,
    query,
    normalizedQuery,
    sort,
    formatFilter,
    coverFilter,
    availableFormats,
    activeViewOptionCount,
    canSortTracks,
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
    resetViewOptions,
    showMore
  };
}

export type LibraryNavigation = ReturnType<typeof useLibraryNavigation>;
