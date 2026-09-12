import { useEffect, useMemo, useRef, useState } from 'react';
import type { Playlist, Track } from '@home-music/shared';
import {
  ChevronLeft,
  Disc3,
  Folder,
  House,
  ListMusic,
  Music2,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  UserRound,
  Volume2
} from 'lucide-react';
import type { LibraryNavigation } from '../useLibraryNavigation';
import { Artwork } from './Artwork';

type TvView = 'home' | 'folders' | 'albums' | 'artists' | 'songs' | 'search' | 'playlists';

type CollectionGroup = {
  key: string;
  name: string;
  subtitle: string;
  tracks: Track[];
  artwork?: Track;
};

type TvExperienceProps = {
  username: string;
  tracks: Track[];
  playlists: Playlist[];
  navigation: LibraryNavigation;
  current?: Track;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onOpenAccount: () => void;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function trackArtist(track: Track) {
  return track.albumArtist || track.artist || 'Artista desconhecido';
}

function useTvClock() {
  const [value, setValue] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setValue(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function useSpatialNavigation(rootRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const focusInitial = window.setTimeout(() => {
      if (root.contains(document.activeElement)) return;
      root.querySelector<HTMLElement>('[data-tv-autofocus="true"]')?.focus();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      const directions = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      if (!directions.includes(event.key)) return;

      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;

      if (
        (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) return;

      const currentRect = active.getBoundingClientRect();
      const currentX = currentRect.left + currentRect.width / 2;
      const currentY = currentRect.top + currentRect.height / 2;
      const candidates = [...root.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )].filter(element => element !== active && element.offsetParent !== null);

      let best: HTMLElement | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const dx = x - currentX;
        const dy = y - currentY;

        const eligible = event.key === 'ArrowRight' ? dx > 4
          : event.key === 'ArrowLeft' ? dx < -4
            : event.key === 'ArrowDown' ? dy > 4
              : dy < -4;
        if (!eligible) continue;

        const primary = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? Math.abs(dx) : Math.abs(dy);
        const secondary = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
        const score = primary * 4 + secondary;
        if (score < bestScore) {
          best = candidate;
          bestScore = score;
        }
      }

      if (!best) return;
      event.preventDefault();
      best.focus({ preventScroll: true });
      best.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusInitial);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [rootRef]);
}

function buildAlbums(tracks: Track[]): CollectionGroup[] {
  const groups = new Map<string, CollectionGroup>();
  for (const track of tracks) {
    const name = track.album?.trim() || 'Sem álbum';
    const artist = trackArtist(track);
    const key = `${artist}\u0000${name}`;
    const existing = groups.get(key);
    if (existing) {
      existing.tracks.push(track);
      if (!existing.artwork?.hasCover && track.hasCover) existing.artwork = track;
      continue;
    }
    groups.set(key, { key, name, subtitle: artist, tracks: [track], artwork: track });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function buildArtists(tracks: Track[]): CollectionGroup[] {
  const groups = new Map<string, CollectionGroup>();
  for (const track of tracks) {
    const name = trackArtist(track);
    const existing = groups.get(name);
    if (existing) {
      existing.tracks.push(track);
      if (!existing.artwork?.hasCover && track.hasCover) existing.artwork = track;
      continue;
    }
    groups.set(name, { key: name, name, subtitle: 'Artista', tracks: [track], artwork: track });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <header className="tv-section-title">
      <h2>{title}</h2>
      {action && onAction && <button type="button" onClick={onAction}>{action}</button>}
    </header>
  );
}

function CollectionCard({ group, onPlay }: { group: CollectionGroup; onPlay: () => void }) {
  return (
    <button className="tv-collection-card" type="button" onClick={onPlay}>
      <span className="tv-collection-card__art"><Artwork track={group.artwork} /></span>
      <strong>{group.name}</strong>
      <small>{group.subtitle}</small>
    </button>
  );
}

function TrackRow({ track, index, current, playing, context, onPlay }: {
  track: Track;
  index: number;
  current?: Track;
  playing: boolean;
  context: Track[];
  onPlay: (track: Track, context: Track[]) => void;
}) {
  const isCurrent = track.id === current?.id;
  return (
    <button className={`tv-track-row ${isCurrent ? 'is-current' : ''}`} type="button" onClick={() => onPlay(track, context)}>
      <span className="tv-track-row__index">{isCurrent && playing ? <Pause /> : index + 1}</span>
      <Artwork track={track} />
      <span className="tv-track-row__copy">
        <strong>{track.title}</strong>
        <small>{trackArtist(track)}{track.album ? ` · ${track.album}` : ''}</small>
      </span>
      <span className="tv-track-row__duration">{formatTime(track.duration ?? 0)}</span>
    </button>
  );
}

export function TvExperience({
  username,
  tracks,
  playlists,
  navigation,
  current,
  playing,
  currentTime,
  duration,
  volume,
  usesSystemVolume,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onPlayTrack,
  onOpenAccount
}: TvExperienceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<TvView>('home');
  const [searchQuery, setSearchQuery] = useState('');
  const clock = useTvClock();
  const albums = useMemo(() => buildAlbums(tracks), [tracks]);
  const artists = useMemo(() => buildArtists(tracks), [tracks]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('pt-BR');
    if (!query) return [];
    return tracks.filter(track => [track.title, track.artist, track.albumArtist, track.album, track.folder]
      .some(value => value?.toLocaleLowerCase('pt-BR').includes(query))).slice(0, 80);
  }, [searchQuery, tracks]);

  useSpatialNavigation(rootRef);

  function openView(nextView: TvView) {
    if (nextView === 'home' || nextView === 'folders') navigation.selectTab('folders');
    if (nextView === 'playlists') navigation.selectTab('playlists');
    setView(nextView);
  }

  function playGroup(group: CollectionGroup) {
    const first = group.tracks[0];
    if (first) onPlayTrack(first, group.tracks);
  }

  function renderHome() {
    const folders = navigation.visibleFolders.slice(0, 6);
    const homeAlbums = albums.slice(0, 6);
    const homeTracks = tracks.slice(0, 6);
    return (
      <>
        <section className="tv-section">
          <SectionTitle title="Pastas" action="Ver todas" onAction={() => openView('folders')} />
          <div className="tv-folder-grid">
            {folders.map(folder => (
              <button className="tv-folder-card" type="button" key={folder.path} onClick={() => {
                navigation.enterFolder(folder.path);
                setView('folders');
              }}>
                <span className="tv-folder-card__art"><Artwork track={folder.artwork} /></span>
                <span className="tv-folder-card__shade" />
                <span className="tv-folder-card__copy">
                  <strong>{folder.name}</strong>
                  <small>{folder.matchingTrackCount} música{folder.matchingTrackCount === 1 ? '' : 's'}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="tv-section">
          <SectionTitle title="Álbuns" action="Ver todos" onAction={() => openView('albums')} />
          <div className="tv-collection-grid">
            {homeAlbums.map(group => <CollectionCard key={group.key} group={group} onPlay={() => playGroup(group)} />)}
          </div>
        </section>

        <section className="tv-section tv-section--tracks">
          <SectionTitle title="Músicas da biblioteca" action="Ver todas" onAction={() => openView('songs')} />
          <div className="tv-track-list">
            {homeTracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={homeTracks} onPlay={onPlayTrack} />
            ))}
          </div>
        </section>
      </>
    );
  }

  function renderFolders() {
    const folderTracks = navigation.libraryTracks.slice(0, 80);
    return (
      <>
        <div className="tv-view-heading">
          {navigation.folderPath && (
            <button className="tv-back-button" type="button" onClick={navigation.leaveFolder}><ChevronLeft /> Voltar</button>
          )}
          <div>
            <span>Pastas</span>
            <h1>{navigation.folderView.name || 'Biblioteca'}</h1>
          </div>
        </div>
        {navigation.visibleFolders.length > 0 && (
          <div className="tv-folder-grid tv-folder-grid--browse">
            {navigation.visibleFolders.slice(0, 48).map(folder => (
              <button className="tv-folder-card" type="button" key={folder.path} onClick={() => navigation.enterFolder(folder.path)}>
                <span className="tv-folder-card__art"><Artwork track={folder.artwork} /></span>
                <span className="tv-folder-card__shade" />
                <span className="tv-folder-card__copy">
                  <strong>{folder.name}</strong>
                  <small>{folder.matchingTrackCount} música{folder.matchingTrackCount === 1 ? '' : 's'}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {folderTracks.length > 0 && (
          <section className="tv-section tv-section--tracks">
            <SectionTitle title="Músicas" />
            <div className="tv-track-list">
              {folderTracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={folderTracks} onPlay={onPlayTrack} />)}
            </div>
          </section>
        )}
      </>
    );
  }

  function renderCollections(title: string, groups: CollectionGroup[]) {
    return (
      <>
        <div className="tv-view-heading"><div><span>Biblioteca</span><h1>{title}</h1></div></div>
        <div className="tv-collection-grid tv-collection-grid--browse">
          {groups.slice(0, 80).map(group => <CollectionCard key={group.key} group={group} onPlay={() => playGroup(group)} />)}
        </div>
      </>
    );
  }

  function renderSongs(context = tracks) {
    return (
      <>
        <div className="tv-view-heading"><div><span>Biblioteca</span><h1>Músicas</h1></div></div>
        <div className="tv-track-list">
          {context.slice(0, 100).map((track, index) => <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={context} onPlay={onPlayTrack} />)}
        </div>
      </>
    );
  }

  function renderSearch() {
    return (
      <>
        <div className="tv-view-heading"><div><span>Biblioteca</span><h1>Buscar</h1></div></div>
        <label className="tv-search-field">
          <Search aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            placeholder="Música, artista, álbum ou pasta"
            onChange={event => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="tv-track-list tv-search-results">
          {searchQuery.trim() && searchResults.length === 0 && <p className="tv-empty">Nenhum resultado encontrado.</p>}
          {searchResults.map((track, index) => <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={searchResults} onPlay={onPlayTrack} />)}
        </div>
      </>
    );
  }

  function renderPlaylists() {
    if (navigation.selectedPlaylist) {
      const playlistTracks = navigation.libraryTracks;
      return (
        <>
          <div className="tv-view-heading">
            <button className="tv-back-button" type="button" onClick={navigation.leavePlaylist}><ChevronLeft /> Playlists</button>
            <div><span>Playlist</span><h1>{navigation.selectedPlaylist.name}</h1></div>
          </div>
          <div className="tv-track-list">
            {playlistTracks.map((track, index) => <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={playlistTracks} onPlay={onPlayTrack} />)}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="tv-view-heading"><div><span>Biblioteca</span><h1>Playlists</h1></div></div>
        <div className="tv-playlist-grid">
          {playlists.map(playlist => (
            <button className="tv-playlist-card" type="button" key={playlist.id} onClick={() => navigation.selectPlaylist(playlist.id)}>
              <ListMusic />
              <strong>{playlist.name}</strong>
              <small>{playlist.trackIds.length} música{playlist.trackIds.length === 1 ? '' : 's'}</small>
            </button>
          ))}
        </div>
      </>
    );
  }

  const navItems: Array<{ view?: TvView; label: string; icon: typeof House; action?: () => void }> = [
    { view: 'home', label: 'Início', icon: House },
    { view: 'folders', label: 'Pastas', icon: Folder },
    { view: 'albums', label: 'Álbuns', icon: Disc3 },
    { view: 'artists', label: 'Artistas', icon: UserRound },
    { view: 'songs', label: 'Músicas', icon: Music2 },
    { view: 'search', label: 'Buscar', icon: Search },
    { view: 'playlists', label: 'Playlists', icon: ListMusic },
    { label: 'Configurações', icon: Settings, action: onOpenAccount }
  ];

  return (
    <main ref={rootRef} className="app-shell tv-app">
      <div className="tv-shell">
        <aside className="tv-sidebar">
          <div className="tv-brand"><Music2 /><strong>Home Music</strong><span>TV</span></div>
          <nav className="tv-nav" aria-label="Navegação da TV">
            {navItems.map(item => {
              const Icon = item.icon;
              const active = item.view === view;
              return (
                <button
                  key={item.label}
                  type="button"
                  className={active ? 'is-active' : ''}
                  data-tv-autofocus={item.view === 'home' ? 'true' : undefined}
                  onClick={() => item.action ? item.action() : item.view && openView(item.view)}
                >
                  <Icon aria-hidden="true" /><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="tv-sidebar__profile"><span>{username}</span><small>{tracks.length} músicas</small></div>
        </aside>

        <section className="tv-content-shell">
          <header className="tv-topbar">
            <span className="tv-topbar__hint">Use as setas do controle para navegar</span>
            <button type="button" aria-label="Buscar" onClick={() => openView('search')}><Search /></button>
            <time>{clock}</time>
          </header>
          <div className="tv-content">
            {view === 'home' && renderHome()}
            {view === 'folders' && renderFolders()}
            {view === 'albums' && renderCollections('Álbuns', albums)}
            {view === 'artists' && renderCollections('Artistas', artists)}
            {view === 'songs' && renderSongs()}
            {view === 'search' && renderSearch()}
            {view === 'playlists' && renderPlaylists()}
          </div>
        </section>
      </div>

      <footer className="tv-playerbar">
        <div className="tv-playerbar__track">
          <Artwork track={current} />
          <span><strong>{current?.title || 'Escolha uma música'}</strong><small>{current ? trackArtist(current) : 'Home Music'}</small></span>
        </div>
        <div className="tv-playerbar__controls">
          <button type="button" aria-label="Anterior" disabled={!current} onClick={onPrevious}><SkipBack /></button>
          <button className="tv-playerbar__play" type="button" aria-label={playing ? 'Pausar' : 'Tocar'} disabled={!current} onClick={onTogglePlay}>{playing ? <Pause /> : <Play />}</button>
          <button type="button" aria-label="Próxima" disabled={!current} onClick={onNext}><SkipForward /></button>
        </div>
        <div className="tv-playerbar__progress">
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(currentTime, Math.max(duration, 1))}
            disabled={!current || duration <= 0}
            aria-label="Progresso da música"
            onChange={event => onSeek(Number(event.target.value))}
          />
          <span><small>{formatTime(currentTime)}</small><small>{formatTime(duration)}</small></span>
        </div>
        <div className="tv-playerbar__volume">
          <Volume2 />
          {usesSystemVolume ? <small>Volume da TV</small> : (
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              aria-label="Volume"
              onChange={event => onVolume(Number(event.target.value))}
            />
          )}
        </div>
      </footer>
    </main>
  );
}
