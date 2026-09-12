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
import {
  clampTvSeek,
  stepTvVolume,
  TV_SEEK_STEP_SECONDS,
  TV_VOLUME_STEP,
  tvCrossfadeOptions
} from '../tv-controls';
import type { LibraryNavigation } from '../useLibraryNavigation';
import { Artwork } from './Artwork';

type TvView = 'home' | 'library' | 'search' | 'playlists' | 'settings';
type LibrarySection = 'folders' | 'albums' | 'artists' | 'songs';
type TvZone = 'sidebar' | 'content' | 'player';

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
  crossfadeSeconds: number;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
  onCrossfadeSeconds: (seconds: number) => void;
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

function focusableInZone(root: HTMLElement, zone: TvZone) {
  return [...root.querySelectorAll<HTMLElement>(`[data-tv-zone="${zone}"]:not(:disabled)`)]
    .filter(element => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
}

function directionalCandidate(active: HTMLElement, candidates: HTMLElement[], key: string) {
  const currentRect = active.getBoundingClientRect();
  const currentX = currentRect.left + currentRect.width / 2;
  const currentY = currentRect.top + currentRect.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate === active) continue;
    const rect = candidate.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - currentX;
    const dy = y - currentY;
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const eligible = key === 'ArrowRight' ? dx > 4
      : key === 'ArrowLeft' ? dx < -4
        : key === 'ArrowDown' ? dy > 4
          : dy < -4;
    if (!eligible) continue;

    const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
    const score = primary * 5 + secondary;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function useTvNavigation(
  rootRef: React.RefObject<HTMLElement | null>,
  options: {
    currentTime: number;
    duration: number;
    volume: number;
    onSeek: (seconds: number) => void;
    onVolume: (volume: number) => void;
  }
) {
  const lastContentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const focusElement = (element: HTMLElement | null) => {
      if (!element) return false;
      element.focus({ preventScroll: true });
      if (element.dataset.tvZone === 'content') {
        element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
      return true;
    };

    const focusInitial = window.setTimeout(() => {
      if (root.contains(document.activeElement)) return;
      focusElement(root.querySelector<HTMLElement>('[data-tv-autofocus="true"]'));
    }, 0);

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.dataset.tvZone === 'content') lastContentRef.current = target;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root.contains(active)) return;
      const zone = active.dataset.tvZone as TvZone | undefined;
      if (!zone) return;

      if (
        (active.matches('input[type="search"], input[type="text"], textarea'))
        && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) return;

      if (zone === 'player' && active.dataset.tvControl === 'seek' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? TV_SEEK_STEP_SECONDS : -TV_SEEK_STEP_SECONDS;
        options.onSeek(clampTvSeek(options.currentTime, options.duration, delta));
        return;
      }

      if (zone === 'player' && active.dataset.tvControl === 'volume' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? TV_VOLUME_STEP : -TV_VOLUME_STEP;
        options.onVolume(stepTvVolume(options.volume, delta));
        return;
      }

      if (zone === 'sidebar') {
        const sidebar = focusableInZone(root, 'sidebar');
        const index = sidebar.indexOf(active);
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          const target = sidebar[Math.max(0, Math.min(sidebar.length - 1, index + delta))];
          if (target && target !== active) {
            event.preventDefault();
            focusElement(target);
          }
          return;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          const content = lastContentRef.current && root.contains(lastContentRef.current)
            ? lastContentRef.current
            : focusableInZone(root, 'content')[0];
          focusElement(content);
        }
        return;
      }

      if (zone === 'player') {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          const content = lastContentRef.current && root.contains(lastContentRef.current)
            ? lastContentRef.current
            : focusableInZone(root, 'content')[0];
          focusElement(content);
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          const player = focusableInZone(root, 'player');
          const index = player.indexOf(active);
          const delta = event.key === 'ArrowRight' ? 1 : -1;
          const target = player[index + delta];
          if (target) {
            event.preventDefault();
            focusElement(target);
          }
        }
        return;
      }

      const content = focusableInZone(root, 'content');
      const next = directionalCandidate(active, content, event.key);
      if (next) {
        event.preventDefault();
        focusElement(next);
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        const sidebarTarget = root.querySelector<HTMLElement>('[data-tv-zone="sidebar"].is-active')
          ?? focusableInZone(root, 'sidebar')[0];
        focusElement(sidebarTarget);
        return;
      }

      if (event.key === 'ArrowDown') {
        const playerTarget = root.querySelector<HTMLElement>('[data-tv-player-primary="true"]')
          ?? focusableInZone(root, 'player')[0];
        if (playerTarget) {
          event.preventDefault();
          focusElement(playerTarget);
        }
      }
    };

    root.addEventListener('focusin', onFocusIn);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusInitial);
      root.removeEventListener('focusin', onFocusIn);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [options.currentTime, options.duration, options.onSeek, options.onVolume, options.volume, rootRef]);
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
      {action && onAction && (
        <button data-tv-zone="content" type="button" onClick={onAction}>{action}</button>
      )}
    </header>
  );
}

function CollectionCard({ group, onPlay }: { group: CollectionGroup; onPlay: () => void }) {
  return (
    <button data-tv-zone="content" className="tv-collection-card" type="button" onClick={onPlay}>
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
    <button
      data-tv-zone="content"
      className={`tv-track-row ${isCurrent ? 'is-current' : ''}`}
      type="button"
      onClick={() => onPlay(track, context)}
    >
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
  crossfadeSeconds,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onCrossfadeSeconds,
  onPlayTrack,
  onOpenAccount
}: TvExperienceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [view, setView] = useState<TvView>('home');
  const [librarySection, setLibrarySection] = useState<LibrarySection>('folders');
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
  const progressPercent = duration > 0 ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0;
  const crossfadeOptions = useMemo(() => tvCrossfadeOptions(crossfadeSeconds), [crossfadeSeconds]);

  useTvNavigation(rootRef, { currentTime, duration, volume, onSeek, onVolume });

  function openView(nextView: TvView) {
    if (nextView === 'home' || nextView === 'library') navigation.selectTab('folders');
    if (nextView === 'playlists') navigation.selectTab('playlists');
    setView(nextView);
  }

  function openLibrary(section: LibrarySection) {
    if (section === 'folders') navigation.selectTab('folders');
    setLibrarySection(section);
    setView('library');
  }

  function playGroup(group: CollectionGroup) {
    const first = group.tracks[0];
    if (first) onPlayTrack(first, group.tracks);
  }

  function renderHome() {
    const folders = navigation.visibleFolders.slice(0, 6);
    const homeAlbums = albums.slice(0, 6);
    return (
      <>
        <div className="tv-view-heading tv-home-heading">
          <div><span>Início</span><h1>O que você quer ouvir?</h1></div>
        </div>
        <section className="tv-section">
          <SectionTitle title="Pastas" action="Abrir biblioteca" onAction={() => openLibrary('folders')} />
          <div className="tv-folder-grid tv-home-grid">
            {folders.map(folder => (
              <button
                data-tv-zone="content"
                className="tv-folder-card"
                type="button"
                key={folder.path}
                onClick={() => {
                  navigation.enterFolder(folder.path);
                  setLibrarySection('folders');
                  setView('library');
                }}
              >
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
          <SectionTitle title="Álbuns" action="Ver todos" onAction={() => openLibrary('albums')} />
          <div className="tv-collection-grid tv-home-grid">
            {homeAlbums.map(group => <CollectionCard key={group.key} group={group} onPlay={() => playGroup(group)} />)}
          </div>
        </section>
      </>
    );
  }

  function renderFolders() {
    const folderTracks = navigation.libraryTracks.slice(0, 80);
    return (
      <>
        {navigation.folderPath && (
          <button data-tv-zone="content" className="tv-back-button" type="button" onClick={navigation.leaveFolder}>
            <ChevronLeft /> Voltar
          </button>
        )}
        <div className="tv-folder-grid tv-folder-grid--browse">
          {navigation.visibleFolders.slice(0, 48).map(folder => (
            <button
              data-tv-zone="content"
              className="tv-folder-card"
              type="button"
              key={folder.path}
              onClick={() => navigation.enterFolder(folder.path)}
            >
              <span className="tv-folder-card__art"><Artwork track={folder.artwork} /></span>
              <span className="tv-folder-card__shade" />
              <span className="tv-folder-card__copy">
                <strong>{folder.name}</strong>
                <small>{folder.matchingTrackCount} música{folder.matchingTrackCount === 1 ? '' : 's'}</small>
              </span>
            </button>
          ))}
        </div>
        {folderTracks.length > 0 && navigation.folderPath && (
          <section className="tv-section tv-section--tracks">
            <SectionTitle title="Músicas" />
            <div className="tv-track-list">
              {folderTracks.map((track, index) => (
                <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={folderTracks} onPlay={onPlayTrack} />
              ))}
            </div>
          </section>
        )}
      </>
    );
  }

  function renderCollections(groups: CollectionGroup[]) {
    return (
      <div className="tv-collection-grid tv-collection-grid--browse">
        {groups.slice(0, 80).map(group => <CollectionCard key={group.key} group={group} onPlay={() => playGroup(group)} />)}
      </div>
    );
  }

  function renderSongs(context = tracks) {
    return (
      <div className="tv-track-list">
        {context.slice(0, 100).map((track, index) => (
          <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={context} onPlay={onPlayTrack} />
        ))}
      </div>
    );
  }

  function renderLibrary() {
    const sections: Array<{ id: LibrarySection; label: string; icon: typeof Folder }> = [
      { id: 'folders', label: 'Pastas', icon: Folder },
      { id: 'albums', label: 'Álbuns', icon: Disc3 },
      { id: 'artists', label: 'Artistas', icon: UserRound },
      { id: 'songs', label: 'Músicas', icon: Music2 }
    ];
    const title = librarySection === 'folders'
      ? (navigation.folderView.name || 'Pastas')
      : sections.find(section => section.id === librarySection)?.label ?? 'Biblioteca';

    return (
      <>
        <div className="tv-view-heading">
          <div><span>Biblioteca</span><h1>{title}</h1></div>
        </div>
        <div className="tv-library-tabs" aria-label="Seções da biblioteca">
          {sections.map(section => {
            const Icon = section.icon;
            return (
              <button
                data-tv-zone="content"
                type="button"
                key={section.id}
                className={librarySection === section.id ? 'is-active' : ''}
                aria-pressed={librarySection === section.id}
                onClick={() => {
                  if (section.id === 'folders' && librarySection !== 'folders') navigation.selectTab('folders');
                  setLibrarySection(section.id);
                }}
              >
                <Icon /><span>{section.label}</span>
              </button>
            );
          })}
        </div>
        <div className="tv-library-body">
          {librarySection === 'folders' && renderFolders()}
          {librarySection === 'albums' && renderCollections(albums)}
          {librarySection === 'artists' && renderCollections(artists)}
          {librarySection === 'songs' && renderSongs()}
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
            data-tv-zone="content"
            type="search"
            value={searchQuery}
            placeholder="Música, artista, álbum ou pasta"
            onChange={event => setSearchQuery(event.target.value)}
          />
        </label>
        <div className="tv-track-list tv-search-results">
          {searchQuery.trim() && searchResults.length === 0 && <p className="tv-empty">Nenhum resultado encontrado.</p>}
          {searchResults.map((track, index) => (
            <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={searchResults} onPlay={onPlayTrack} />
          ))}
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
            <button data-tv-zone="content" className="tv-back-button" type="button" onClick={navigation.leavePlaylist}>
              <ChevronLeft /> Playlists
            </button>
            <div><span>Playlist</span><h1>{navigation.selectedPlaylist.name}</h1></div>
          </div>
          <div className="tv-track-list">
            {playlistTracks.map((track, index) => (
              <TrackRow key={track.id} track={track} index={index} current={current} playing={playing} context={playlistTracks} onPlay={onPlayTrack} />
            ))}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="tv-view-heading"><div><span>Biblioteca</span><h1>Playlists</h1></div></div>
        <div className="tv-playlist-grid">
          {playlists.map(playlist => (
            <button
              data-tv-zone="content"
              className="tv-playlist-card"
              type="button"
              key={playlist.id}
              onClick={() => navigation.selectPlaylist(playlist.id)}
            >
              <ListMusic />
              <strong>{playlist.name}</strong>
              <small>{playlist.trackIds.length} música{playlist.trackIds.length === 1 ? '' : 's'}</small>
            </button>
          ))}
        </div>
      </>
    );
  }

  function renderSettings() {
    return (
      <>
        <div className="tv-view-heading"><div><span>TV</span><h1>Ajustes rápidos</h1></div></div>
        <section className="tv-settings-card">
          <div className="tv-settings-card__heading">
            <Music2 />
            <div>
              <strong>Crossfade</strong>
              <small>{crossfadeSeconds === 0 ? 'Desativado' : `${crossfadeSeconds} s entre músicas`}</small>
            </div>
          </div>
          <div className="tv-choice-row" aria-label="Duração do crossfade">
            {crossfadeOptions.map(seconds => (
              <button
                data-tv-zone="content"
                key={seconds}
                type="button"
                aria-pressed={crossfadeSeconds === seconds}
                className={crossfadeSeconds === seconds ? 'is-active' : ''}
                onClick={() => onCrossfadeSeconds(seconds)}
              >
                {seconds === 0 ? 'Desligado' : `${seconds} s`}
              </button>
            ))}
          </div>
        </section>

        <section className="tv-settings-card tv-settings-card--account">
          <div className="tv-settings-card__heading">
            <UserRound />
            <div><strong>{username}</strong><small>Conta, sessões e preferências avançadas</small></div>
          </div>
          <button data-tv-zone="content" className="tv-settings-account" type="button" onClick={onOpenAccount}>
            Abrir Minha conta
          </button>
        </section>
      </>
    );
  }

  const navItems: Array<{ view: Exclude<TvView, 'settings'>; label: string; icon: typeof House }> = [
    { view: 'home', label: 'Início', icon: House },
    { view: 'library', label: 'Biblioteca', icon: Folder },
    { view: 'search', label: 'Buscar', icon: Search },
    { view: 'playlists', label: 'Playlists', icon: ListMusic }
  ];

  return (
    <main ref={rootRef} className="app-shell tv-app tv-app--v2">
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
                  data-tv-zone="sidebar"
                  data-tv-view={item.view}
                  type="button"
                  className={active ? 'is-active' : ''}
                  data-tv-autofocus={item.view === 'home' ? 'true' : undefined}
                  onClick={() => openView(item.view)}
                >
                  <Icon aria-hidden="true" /><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="tv-content-shell">
          <header className="tv-topbar">
            <span className="tv-topbar__hint">Setas navegam · OK seleciona</span>
            <button data-tv-zone="content" type="button" aria-label="Buscar" onClick={() => openView('search')}><Search /></button>
            <button
              data-tv-zone="content"
              className={`tv-account-button ${view === 'settings' ? 'is-active' : ''}`}
              type="button"
              aria-label="Ajustes rápidos e Minha conta"
              onClick={() => setView('settings')}
            >
              <Settings /><span>{username}</span>
            </button>
            <time>{clock}</time>
          </header>
          <div className="tv-content">
            {view === 'home' && renderHome()}
            {view === 'library' && renderLibrary()}
            {view === 'search' && renderSearch()}
            {view === 'playlists' && renderPlaylists()}
            {view === 'settings' && renderSettings()}
          </div>
        </section>
      </div>

      <footer className="tv-playerbar">
        <div className="tv-playerbar__track">
          <Artwork track={current} />
          <span><strong>{current?.title || 'Escolha uma música'}</strong><small>{current ? trackArtist(current) : 'Home Music'}</small></span>
        </div>
        <div className="tv-playerbar__controls">
          <button data-tv-zone="player" type="button" aria-label="Anterior" disabled={!current} onClick={onPrevious}><SkipBack /></button>
          <button
            data-tv-zone="player"
            data-tv-player-primary="true"
            className="tv-playerbar__play"
            type="button"
            aria-label={playing ? 'Pausar' : 'Tocar'}
            disabled={!current}
            onClick={onTogglePlay}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <button data-tv-zone="player" type="button" aria-label="Próxima" disabled={!current} onClick={onNext}><SkipForward /></button>
        </div>
        <button
          data-tv-zone="player"
          data-tv-control="seek"
          className="tv-playerbar__seek"
          type="button"
          disabled={!current || duration <= 0}
          aria-label={`Progresso ${formatTime(currentTime)} de ${formatTime(duration)}. Use esquerda e direita para pular ${TV_SEEK_STEP_SECONDS} segundos.`}
        >
          <span className="tv-playerbar__seek-track"><span style={{ width: `${progressPercent}%` }} /></span>
          <span className="tv-playerbar__seek-time"><small>{formatTime(currentTime)}</small><small>{formatTime(duration)}</small></span>
          <small className="tv-playerbar__seek-hint">← / → {TV_SEEK_STEP_SECONDS}s</small>
        </button>
        <div className="tv-playerbar__volume">
          <Volume2 />
          {usesSystemVolume ? <small>Volume da TV</small> : (
            <button
              data-tv-zone="player"
              data-tv-control="volume"
              className="tv-playerbar__volume-control"
              type="button"
              aria-label={`Volume ${Math.round(volume * 100)}%. Use esquerda e direita para ajustar.`}
            >
              <span>{Math.round(volume * 100)}%</span><small>← / →</small>
            </button>
          )}
        </div>
      </footer>
    </main>
  );
}
