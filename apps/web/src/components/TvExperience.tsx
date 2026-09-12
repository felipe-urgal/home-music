import { useEffect, useRef } from 'react';
import type { Playlist, Track } from '@home-music/shared';
import { AudioLines, Music2, Pause, Play, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { useCrossfadeVisualState } from '../crossfade-visual';
import { resolveTvCrossfadePresentation } from '../tv-crossfade';
import type { LibraryNavigation } from '../useLibraryNavigation';
import { Artwork } from './Artwork';
import '../tv-now-playing.css';

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

export function TvExperience({ tracks, current, playing, currentTime, duration, onTogglePlay, onPrevious, onNext, onPlayTrack }: TvExperienceProps) {
  const rootRef = useRef<HTMLElement>(null);
  const crossfade = useCrossfadeVisualState();
  const crossfadePresentation = resolveTvCrossfadePresentation(current, crossfade);
  const incomingTrack = crossfadePresentation.incomingTrack;
  const crossfadeProgress = crossfadePresentation.progress ?? 0;
  const progress = duration > 0 ? Math.max(0, Math.min(100, currentTime / duration * 100)) : 0;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const timer = window.setTimeout(() => root.querySelector<HTMLButtonElement>('[data-tv-primary]')?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const active = document.activeElement as HTMLButtonElement | null;
      if (!active || !root.contains(active) || !active.matches('[data-tv-control]')) return;
      const controls = [...root.querySelectorAll<HTMLButtonElement>('[data-tv-control]:not(:disabled)')];
      const index = controls.indexOf(active);
      const target = controls[index + (event.key === 'ArrowRight' ? 1 : -1)];
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKeyDown); };
  }, []);

  function playRandom() {
    if (!tracks.length) return;
    const alternatives = current && tracks.length > 1 ? tracks.filter(track => track.id !== current.id) : tracks;
    const track = alternatives[Math.floor(Math.random() * alternatives.length)];
    if (track) onPlayTrack(track, tracks);
  }

  return (
    <main ref={rootRef} className="app-shell tv-app tv-app--now-playing">
      <svg className="tv-now-playing__scene" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="tv-record-glow" cx="52%" cy="40%" r="58%"><stop offset="0" stopColor="#d78a4d" stopOpacity=".52"/><stop offset=".44" stopColor="#683c28" stopOpacity=".34"/><stop offset="1" stopColor="#05090d" stopOpacity="0"/></radialGradient>
          <linearGradient id="tv-record-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#17181c"/><stop offset=".5" stopColor="#050608"/><stop offset=".72" stopColor="#3d2015"/><stop offset="1" stopColor="#08090b"/></linearGradient>
          <linearGradient id="tv-arm-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#33363a"/><stop offset=".7" stopColor="#0a0b0e"/><stop offset="1" stopColor="#b96838"/></linearGradient>
          <filter id="tv-scene-blur"><feGaussianBlur stdDeviation="18"/></filter>
        </defs>
        <rect width="1920" height="1080" fill="#05090d"/>
        <ellipse cx="1030" cy="445" rx="760" ry="360" fill="url(#tv-record-glow)" filter="url(#tv-scene-blur)"/>
        <ellipse cx="1045" cy="505" rx="690" ry="310" fill="url(#tv-record-fill)" transform="rotate(-7 1045 505)"/>
        <ellipse cx="1045" cy="505" rx="520" ry="226" fill="none" stroke="#754635" strokeOpacity=".40" strokeWidth="8" transform="rotate(-7 1045 505)"/>
        <ellipse cx="1045" cy="505" rx="365" ry="158" fill="none" stroke="#dc9364" strokeOpacity=".18" strokeWidth="5" transform="rotate(-7 1045 505)"/>
        <path d="M1370 244 L1850 205 L1878 310 L1420 366 Z" fill="url(#tv-arm-fill)" opacity=".98"/>
        <path d="M1410 357 L1490 375 L1462 485 L1393 463 Z" fill="#14161a"/><path d="M1430 452 L1470 465 L1452 520 L1412 507 Z" fill="#9a4d2c"/>
      </svg>
      <div className="tv-now-playing__shade" aria-hidden="true" />

      <header className="tv-now-playing__header">
        <div className="tv-now-playing__brand"><span><Music2 aria-hidden="true" /></span><strong>Home Music</strong></div>
      </header>

      <section className="tv-now-playing__center" aria-live="polite">
        <div
          className="tv-now-playing__identity-stack"
          data-crossfading={incomingTrack ? 'true' : 'false'}
          data-crossfade-progress={crossfadePresentation.progress ?? undefined}
        >
          <div
            className="tv-now-playing__identity tv-now-playing__identity--outgoing"
            style={{
              opacity: crossfadePresentation.outgoingOpacity,
              transform: `scale(${1 - crossfadeProgress * 0.035})`
            }}
          >
            <div className="tv-now-playing__art"><Artwork track={current} large /></div>
            <h1 className="tv-now-playing__title">{current?.title || 'Nada tocando'}</h1>
            <p className="tv-now-playing__artist">{current ? trackArtist(current) : 'Use o celular para escolher uma música'}</p>
            <p className="tv-now-playing__album">{current?.album || ''}</p>
          </div>

          {incomingTrack && (
            <div
              className="tv-now-playing__identity tv-now-playing__identity--incoming"
              aria-hidden="true"
              style={{
                opacity: crossfadePresentation.incomingOpacity,
                transform: `scale(${0.965 + crossfadeProgress * 0.035})`
              }}
            >
              <div className="tv-now-playing__art"><Artwork track={incomingTrack} large /></div>
              <div className="tv-now-playing__title">{incomingTrack.title}</div>
              <p className="tv-now-playing__artist">{trackArtist(incomingTrack)}</p>
              <p className="tv-now-playing__album">{incomingTrack.album || ''}</p>
            </div>
          )}
        </div>

        <div className="tv-now-playing__progress" role="progressbar" aria-label={`${formatTime(currentTime)} de ${formatTime(duration)}`} aria-valuemin={0} aria-valuemax={Math.max(0, Math.round(duration))} aria-valuenow={Math.max(0, Math.round(currentTime))}>
          <span><i style={{ width: `${progress}%` }} /></span><div><small>{formatTime(currentTime)}</small><small>{formatTime(duration)}</small></div>
        </div>
        <div className="tv-now-playing__controls" aria-label="Controles da TV">
          <button data-tv-control type="button" aria-label="Aleatório" disabled={!current} onClick={playRandom}><Shuffle aria-hidden="true" /></button>
          <button data-tv-control type="button" aria-label="Faixa anterior" disabled={!current} onClick={onPrevious}><SkipBack aria-hidden="true" /></button>
          <button data-tv-control data-tv-primary type="button" className="tv-now-playing__play" aria-label={playing ? 'Pausar' : 'Tocar'} disabled={!current} onClick={onTogglePlay}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</button>
          <button data-tv-control type="button" aria-label="Próxima faixa" disabled={!current} onClick={onNext}><SkipForward aria-hidden="true" /></button>
          <button data-tv-control type="button" aria-label="Outra faixa aleatória" disabled={!current} onClick={playRandom}><Shuffle aria-hidden="true" /></button>
        </div>
      </section>

      <footer className="tv-now-playing__footer"><div><AudioLines aria-hidden="true" /><span>TOCANDO AGORA</span></div><p>“Good music<br/>makes a better home.”</p></footer>
    </main>
  );
}
