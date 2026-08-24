import { useDeferredValue, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Disc3, Folder, Music2, Play, Search, Users } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { groupTracks, matchesTrack, normalizeSearch, type GroupTab } from '../library-utils';
import { Artwork } from './Artwork';
import { MiniPlayer } from './MiniPlayer';

const PAGE_SIZE = 100;
type LibraryTab = GroupTab | 'tracks';

type LibraryScreenProps = {
  tracks: Track[];
  current: Track;
  playing: boolean;
  hasNext: boolean;
  onOpenPlayer: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
};

function groupLabel(tab: GroupTab) {
  if (tab === 'folders') return 'Pasta';
  if (tab === 'artists') return 'Artista';
  return 'Álbum';
}

export function LibraryScreen({
  tracks,
  current,
  playing,
  hasNext,
  onOpenPlayer,
  onTogglePlay,
  onNext,
  onPlayTrack
}: LibraryScreenProps) {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('folders');
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
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
    setVisibleCount(PAGE_SIZE);
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

  return (
    <>
      <header className="library-header">
        {selectedGroup ? (
          <button className="icon-button" aria-label="Voltar" onClick={leaveGroup}><ChevronLeft /></button>
        ) : (
          <span className="library-header__spacer" />
        )}
        <div className="library-header__title">
          <strong>{selectedGroup?.name ?? 'Biblioteca'}</strong>
          <small>{selectedGroup ? `${libraryTracks.length} músicas` : `${tracks.length} músicas`}</small>
        </div>
        <button className="icon-button" aria-label="Voltar ao player" onClick={onOpenPlayer}><Music2 /></button>
      </header>

      <div className="search-box search-box--library">
        <Search />
        <input value={query} onChange={event => changeQuery(event.target.value)} placeholder="Música, artista, álbum ou pasta" />
      </div>

      {!selectedGroup && (
        <nav className="library-tabs" aria-label="Navegação da biblioteca">
          <button className={libraryTab === 'folders' ? 'is-active' : ''} onClick={() => selectTab('folders')}><Folder />Pastas</button>
          <button className={libraryTab === 'artists' ? 'is-active' : ''} onClick={() => selectTab('artists')}><Users />Artistas</button>
          <button className={libraryTab === 'albums' ? 'is-active' : ''} onClick={() => selectTab('albums')}><Disc3 />Álbuns</button>
          <button className={libraryTab === 'tracks' ? 'is-active' : ''} onClick={() => selectTab('tracks')}><Music2 />Músicas</button>
        </nav>
      )}

      <section className="library-content">
        {shouldShowTracks ? (
          <>
            <div className="section-heading">
              <span>{selectedGroup && libraryTab !== 'tracks' ? groupLabel(libraryTab) : 'Todas as músicas'}</span>
              <small>{libraryTracks.length}</small>
            </div>
            <div className="library-track-list">
              {pagedTracks.map(track => (
                <button className={`library-track ${track.id === current.id ? 'is-current' : ''}`} key={track.id} onClick={() => onPlayTrack(track, libraryTracks)}>
                  <Artwork track={track} />
                  <span className="library-track__text">
                    <strong>{track.title}</strong>
                    <small>{track.artist} · {track.album}</small>
                  </span>
                  {track.id === current.id && playing ? <span className="playing-indicator">▶</span> : <Play className="library-track__action" />}
                </button>
              ))}
            </div>
            {visibleCount < libraryTracks.length && (
              <button className="load-more" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
                Mostrar mais {Math.min(PAGE_SIZE, libraryTracks.length - visibleCount)} músicas
              </button>
            )}
          </>
        ) : (
          <>
            <div className="section-heading">
              <span>{libraryTab === 'folders' ? 'Pastas' : libraryTab === 'artists' ? 'Artistas' : 'Álbuns'}</span>
              <small>{visibleGroups.length}</small>
            </div>
            <div className="group-list">
              {pagedGroups.map(group => (
                <button className="group-item" key={group.key} onClick={() => selectGroup(group.key)}>
                  <Artwork track={group.artwork} />
                  <span className="group-item__text">
                    <strong>{group.name}</strong>
                    <small>{group.subtitle ? `${group.subtitle} · ` : ''}{group.tracks.length} músicas</small>
                  </span>
                  <ChevronRight />
                </button>
              ))}
            </div>
            {visibleCount < visibleGroups.length && (
              <button className="load-more" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>
                Mostrar mais {Math.min(PAGE_SIZE, visibleGroups.length - visibleCount)} itens
              </button>
            )}
          </>
        )}
      </section>

      <MiniPlayer
        current={current}
        playing={playing}
        hasNext={hasNext}
        onOpenPlayer={onOpenPlayer}
        onTogglePlay={onTogglePlay}
        onNext={onNext}
      />
    </>
  );
}
