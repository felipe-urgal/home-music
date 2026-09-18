import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Playlist, Track } from '@home-music/shared';
import { Music2, Pause, Play } from 'lucide-react';
import turntablePhoto from '../assets/tv-turntable.webp';
import { tvNumericShortcut } from '../tv-controls';
import { subscribeToTvRemoteTrackRequests } from '../tv-remote-track-request';
import { useTvArtworkAccent } from '../useTvArtworkAccent';
import type { LibraryNavigation } from '../useLibraryNavigation';
import { Artwork } from './Artwork';
import '../tv-now-playing.css';

type TvExperienceProps = {
  username: string;
  tracks: Track[];
  playlists: Playlist[];
  navigation: LibraryNavigation;
  current?: Track;
  nextTrack?: Track;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onOpenAccount: () => void;
  onOpenRemote: () => void;
};

type TvThemeStyle = CSSProperties & {
  '--tv-accent'?: string;
  '--tv-accent-rgb'?: string;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function visibleMetadata(value: string | null | undefined, unknownLabel: string) {
  const trimmed = value?.trim() ?? '';
  return trimmed.toLocaleLowerCase('pt-BR') === unknownLabel.toLocaleLowerCase('pt-BR') ? '' : trimmed;
}

function trackArtist(track: Track) {
  return visibleMetadata(track.albumArtist, 'Artista desconhecido')
    || visibleMetadata(track.artist, 'Artista desconhecido');
}

function trackAlbum(track: Track) {
  return visibleMetadata(track.album, 'Álbum desconhecido');
}

export function TvExperience({ tracks, current, nextTrack, playing, currentTime, duration, onTogglePlay, onNext, onPlayTrack, onOpenRemote }: TvExperienceProps) {
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const photoRef = useRef<HTMLImageElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const accent = useTvArtworkAccent(current);
  const progress = duration > 0 ? Math.max(0, Math.min(100, currentTime / duration * 100)) : 0;
  const currentArtist = current ? trackArtist(current) : '';
  const currentAlbum = current ? trackAlbum(current) : '';
  const nextArtist = nextTrack ? trackArtist(nextTrack) : '';
  const showNextTrack = Boolean(current && nextTrack);
  const themeStyle: TvThemeStyle = {
    '--tv-accent': accent.color,
    '--tv-accent-rgb': accent.rgb
  };

  useEffect(() => {
    const root = document.documentElement;
    const previousAccent = root.style.getPropertyValue('--tv-accent');
    const previousAccentRgb = root.style.getPropertyValue('--tv-accent-rgb');

    root.style.setProperty('--tv-accent', accent.color);
    root.style.setProperty('--tv-accent-rgb', accent.rgb);

    return () => {
      if (previousAccent) root.style.setProperty('--tv-accent', previousAccent);
      else root.style.removeProperty('--tv-accent');

      if (previousAccentRgb) root.style.setProperty('--tv-accent-rgb', previousAccentRgb);
      else root.style.removeProperty('--tv-accent-rgb');
    };
  }, [accent.color, accent.rgb]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const timer = window.setTimeout(() => {
      const target = current
        ? root.querySelector<HTMLButtonElement>('[data-tv-primary]')
        : document.querySelector<HTMLButtonElement>('[data-tv-entry]');
      target?.focus({ preventScroll: true });
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;

      const shortcut = tvNumericShortcut(event.key, event.code, event.keyCode);
      const shortcutScope = root.contains(active) || active.matches('[data-tv-entry]');
      if (shortcut && shortcutScope && !event.repeat) {
        event.preventDefault();
        if (shortcut === 'open-remote') {
          onOpenRemote();
          return;
        }
        if (!current) return;
        if (shortcut === 'toggle-play') {
          onTogglePlay();
          return;
        }
        onNext();
        return;
      }

      if (event.key === 'ArrowDown' && active.matches('[data-tv-entry]')) {
        const primary = root.querySelector<HTMLButtonElement>('[data-tv-primary]:not(:disabled)');
        if (!primary) return;
        event.preventDefault();
        primary.focus({ preventScroll: true });
        return;
      }

      if (!root.contains(active)) return;

      if (event.key === 'ArrowUp' && active.matches('[data-tv-control]')) {
        const remoteEntry = document.querySelector<HTMLButtonElement>('[data-tv-entry]');
        if (!remoteEntry) return;
        event.preventDefault();
        remoteEntry.focus({ preventScroll: true });
        return;
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!active.matches('[data-tv-control]')) return;

      const controls = [...root.querySelectorAll<HTMLButtonElement>('[data-tv-control]:not(:disabled)')];
      const index = controls.indexOf(active as HTMLButtonElement);
      const target = controls[index + (event.key === 'ArrowRight' ? 1 : -1)];
      if (!target) return;

      event.preventDefault();
      target.focus({ preventScroll: true });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, onNext, onOpenRemote, onTogglePlay]);

  useEffect(() => subscribeToTvRemoteTrackRequests(trackId => {
    const track = tracks.find(candidate => candidate.id === trackId);
    if (track) onPlayTrack(track, tracks);
  }), [onPlayTrack, tracks]);

  return (
    <main ref={rootRef} className="app-shell tv-app tv-app--now-playing" style={themeStyle}>
      <svg className="tv-now-playing__scene" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="tv-record-glow" cx="52%" cy="40%" r="58%">
            <stop offset="0" className="tv-now-playing__accent-stop" stopOpacity=".58" />
            <stop offset=".44" className="tv-now-playing__accent-stop" stopOpacity=".22" />
            <stop offset="1" stopColor="#05090d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="tv-record-fill" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#17181c" />
            <stop offset=".5" stopColor="#050608" />
            <stop offset=".72" className="tv-now-playing__accent-stop" stopOpacity=".30" />
            <stop offset="1" stopColor="#08090b" />
          </linearGradient>
          <linearGradient id="tv-arm-fill" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#33363a" />
            <stop offset=".7" stopColor="#0a0b0e" />
            <stop offset="1" className="tv-now-playing__accent-stop" stopOpacity=".72" />
          </linearGradient>
          <filter id="tv-scene-blur"><feGaussianBlur stdDeviation="18" /></filter>
        </defs>
        <ellipse cx="1115" cy="500" rx="845" ry="405" fill="url(#tv-record-glow)" filter="url(#tv-scene-blur)" />
        <ellipse cx="1110" cy="610" rx="790" ry="350" fill="url(#tv-record-fill)" transform="rotate(-7 1110 610)" />
        <ellipse cx="1110" cy="610" rx="620" ry="270" fill="none" className="tv-now-playing__accent-stroke" strokeOpacity=".24" strokeWidth="8" transform="rotate(-7 1110 610)" />
        <ellipse cx="1110" cy="610" rx="455" ry="198" fill="none" className="tv-now-playing__accent-stroke" strokeOpacity=".16" strokeWidth="5" transform="rotate(-7 1110 610)" />
        <path d="M1400 255 L1880 214 L1900 330 L1452 389 Z" fill="url(#tv-arm-fill)" opacity=".98" />
        <path d="M1446 380 L1528 398 L1496 512 L1428 489 Z" fill="#14161a" />
        <path d="M1468 478 L1505 490 L1484 548 L1445 534 Z" className="tv-now-playing__accent-fill" opacity=".72" />
      </svg>
      <img
        ref={photoRef}
        src={turntablePhoto}
        className="tv-now-playing__photo"
        alt=""
        aria-hidden="true"
        data-loaded={photoLoaded}
        onLoad={event => {
          const image = event.currentTarget;
          void image.decode()
            .then(() => { if (photoRef.current === image) setPhotoLoaded(true); })
            .catch(() => setPhotoLoaded(false));
        }}
        onError={() => setPhotoLoaded(false)}
      />
      <div className="tv-now-playing__shade" aria-hidden="true" />

      <header className="tv-now-playing__header">
        <div className="tv-now-playing__brand">
          <span><Music2 aria-hidden="true" /></span>
          <strong>Home Music</strong>
        </div>
      </header>

      <section className="tv-now-playing__content" aria-live="polite">
        <div className="tv-now-playing__identity">
          <button
            data-tv-control
            data-tv-primary
            type="button"
            className="tv-now-playing__art"
            aria-label={playing ? 'Pausar' : 'Tocar'}
            aria-pressed={playing}
            disabled={!current}
            onClick={onTogglePlay}
          >
            <Artwork track={current} large />
            {current && (
              <span className="tv-now-playing__art-action" aria-hidden="true">
                {playing ? <Pause /> : <Play />}
              </span>
            )}
          </button>
          <div className="tv-now-playing__details">
            <h1 className="tv-now-playing__title">{current?.title || 'Nada tocando'}</h1>
            {currentArtist && <p className="tv-now-playing__artist">{currentArtist}</p>}
            {!current && <p className="tv-now-playing__artist">Escolha uma música pelo celular</p>}
            {currentAlbum && <p className="tv-now-playing__album">{currentAlbum}</p>}
          </div>
        </div>

        {current && (
          <div className="tv-now-playing__transport">
            <div
              className="tv-now-playing__progress"
              role="progressbar"
              aria-label={`${formatTime(currentTime)} de ${formatTime(duration)}`}
              aria-valuemin={0}
              aria-valuemax={Math.max(0, Math.round(duration))}
              aria-valuenow={Math.max(0, Math.round(currentTime))}
            >
              <span><i style={{ width: `${progress}%` }} /></span>
              <div><small>{formatTime(currentTime)}</small><small>{formatTime(duration)}</small></div>
            </div>

          </div>
        )}
      </section>

      {showNextTrack && nextTrack && (
        <button
          data-tv-control
          type="button"
          className="tv-now-playing__next"
          aria-label={`Tocar próxima faixa: ${nextTrack.title}`}
          onClick={onNext}
        >
          <span className="tv-now-playing__next-copy">
            <span>A SEGUIR</span>
            <span>{nextTrack.title}{nextArtist ? ` • ${nextArtist}` : ''}</span>
          </span>
          <span className="tv-now-playing__next-art"><Artwork track={nextTrack} /></span>
        </button>
      )}
    </main>
  );
}
