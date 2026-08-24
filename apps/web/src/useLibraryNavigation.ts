import { useDeferredValue, useMemo, useState } from 'react';
import type { Track } from '@home-music/shared';
import { groupTracks, matchesTrack, normalizeSearch, type GroupTab } from './library-utils';

export const LIBRARY_PAGE_SIZE = 100;
export type LibraryTab = GroupTab | 'tracks';

export function useLibraryNavigation(tracks: Track[]) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('folders');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(LIBRARY_PAGE_SIZE);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = normalizeSearch(deferredQuery);

  const groups = useMemo(() => {
    if (libraryTab === 'tracks') return [];
    return groupTracks(tracks, libraryTab);
  }, [libraryTab, tracks]);

  const selectedGroup = useMemo(
    () => groups.find(group => group.key === selectedGroupKey) ?? null,
    [groups, selectedGroupKey]
  );

  const visibleGroups = useMemo(() => {
    if (!normalizedQuery) return groups;

    return groups.filter(group =>
      normalizeSearch(`${group.name} ${group.subtitle ?? ''}`).includes(normalizedQuery) ||
      group.tracks.some(track => matchesTrack(track, normalizedQuery))
    );
  }, [groups, normalizedQuery]);

  const libraryTracks = useMemo(() => {
    const source = selectedGroup?.tracks ?? tracks;
    return source.filter(track => matchesTrack(track, normalizedQuery));
  }, [normalizedQuery, selectedGroup, tracks]);

  const shouldShowTracks = libraryTab === 'tracks' || Boolean(selectedGroup);
  const pagedTracks = libraryTracks.slice(0, visibleCount);
  const pagedGroups = visibleGroups.slice(0, visibleCount);

  function resetPage() {
    setVisibleCount(LIBRARY_PAGE_SIZE);
  }

  function selectTab(tab: LibraryTab) {
    setLibraryTab(tab);
    setSelectedGroupKey(null);
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
    query,
    visibleCount,
    visibleGroups,
    libraryTracks,
    shouldShowTracks,
    pagedTracks,
    pagedGroups,
    selectTab,
    selectGroup,
    leaveGroup,
    changeQuery,
    showMore
  };
}

export type LibraryNavigation = ReturnType<typeof useLibraryNavigation>;
