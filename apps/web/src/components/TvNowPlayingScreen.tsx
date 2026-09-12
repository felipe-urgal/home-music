import { useEffect, useMemo, useRef } from 'react';
import type { RepeatMode, Track } from '@home-music/shared';
import { AudioLines, Music2, Pause, Play, Repeat2, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { tvRemoteQrDataUrl } from '../tv-remote-qr';
import { Artwork } from './Artwork';

type Props = {
  current?: Track;
  playing: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  currentTime: number;
  duration: number;
  pairingUrl: string | null;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function TvNowPlayingScreen({ current, playing, shuffle, repeatMode, currentTime, duration, pairingUrl, onTogglePlay, onPrevious, onNext, onShuffle, onRepeat }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const qrDataUrl = useMemo(() => {
    if (!pairingUrl) return null;
    try { return tvRemoteQrDataUrl(pairingUrl); } catch { return null; }
  }, [pairingUrl]);
  const progress = duration > 0 ? Math.max(0, Math.min(100, currentTime / duration * 100)) : 0;
  const artist = current?.albumArtist || current?.artist || 'Artista desconhecido';

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const focusTimer = window.setTimeout(() => root.querySelector<HTMLButtonElement>('[data-tv-primary]')?.focus({ preventScroll: true }), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const active = document.activeElement as HTMLButtonElement | null;
      if (!active || !root.contains(active) || !active.matches('[data-tv-control]')) return;
      const controls = [...root.querySelectorAll<HTMLButtonElement>('[data-tv-control]:not(:disabled)')];
      const currentIndex = controls.indexOf(active);
      const target = controls[currentIndex + (event.key === 'ArrowRight' ? 1 : -1)];
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(focusTimer); window.removeEventListener('keydown', onKeyDown); };
  }, []);

  return (
    <main ref={rootRef} className="app-shell tv-app tv-app--now-playing">
      <svg className="tv-now-playing__scene" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="recordGlow" cx="50%" cy="42%" r="58%"><stop offset="0" stopColor="#d78a4d" stopOpacity=".55"/><stop offset=".42" stopColor="#5b3524" stopOpacity=".35"/><stop offset="1" stopColor="#05090d" stopOpacity="0"/></radialGradient>
          <linearGradient id="recordFill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#15161a"/><stop offset=".5" stopColor="#050608"/><stop offset=".72" stopColor="#3a1d13"/><stop offset="1" stopColor="#08090b"/></linearGradient>
          <linearGradient id="armFill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#2e3135"/><stop offset=".7" stopColor="#0a0b0e"/><stop offset="1" stopColor="#b96838"/></linearGradient>
          <filter id="sceneBlur"><feGaussianBlur stdDeviation="18"/></filter>
        </defs>
        <rect width="1920" height="1080" fill="#05090d"/>
        <ellipse cx="1030" cy="445" rx="760" ry="360" fill="url(#recordGlow)" filter="url(#sceneBlur)"/>
        <ellipse cx="1045" cy="505" rx="690" ry="310" fill="url(#recordFill)" transform="rotate(-7 1045 505)"/>
        <ellipse cx="1045" cy="505" rx="520" ry="226" fill="none" stroke="#6d4030" strokeOpacity=".38" strokeWidth="8" transform="rotate(-7 1045 505)"/>
        <ellipse cx="1045" cy="505" rx="365" ry="158" fill="none" stroke="#d18a5d" strokeOpacity=".18" strokeWidth="5" transform="rotate(-7 1045 505)"/>
        <path d="M1370 244 L1850 205 L1878 310 L1420 366 Z" fill="url(#armFill)" opacity=".98"/>
        <path d="M1410 357 L1490 375 L1462 485 L1393 463 Z" fill="#14161a"/><path d="M1430 452 L1470 465 L1452 520 L1412 507 Z" fill="#9a4d2c"/>
      </svg>
      <div className="tv-now-playing__shade" aria-hidden="true" />

      <header className="tv-now-playing__header">
        <div className="tv-now-playing__brand"><span><Music2 /></span><strong>Home Music</strong></div>
        <div className="tv-now-playing__qr">
          {pairingUrl && qrDataUrl ? <a href={pairingUrl} aria-label="Abrir controle no celular"><img src={qrDataUrl} alt="QR code para controlar a TV pelo celular" /><span>Escaneie para<br/>controlar pelo celular</span></a> : <span className="tv-now-playing__qr-loading">Preparando celular...</span>}
        </div>
      </header>

      <section className="tv-now-playing__center" aria-live="polite">
        <div className="tv-now-playing__art"><Artwork track={current} large /></div>
        <h1 className="tv-now-playing__title">{current?.title || 'Nada tocando'}</h1>
        <p className="tv-now-playing__artist">{current ? artist : 'Use o celular para escolher uma música'}</p>
        <p className="tv-now-playing__album">{current?.album || ''}</p>
        <div className="tv-now-playing__progress" role="progressbar" aria-label={`${formatTime(currentTime)} de ${formatTime(duration)}`} aria-valuemin={0} aria-valuemax={Math.max(0, Math.round(duration))} aria-valuenow={Math.max(0, Math.round(currentTime))}>
          <span><i style={{ width: `${progress}%` }} /></span><div><small>{formatTime(currentTime)}</small><small>{formatTime(duration)}</small></div>
        </div>
        <div className="tv-now-playing__controls" aria-label="Controles da TV">
          <button data-tv-control type="button" aria-label="Aleatório" aria-pressed={shuffle} className={shuffle ? 'is-active' : ''} disabled={!current} onClick={onShuffle}><Shuffle /></button>
          <button data-tv-control type="button" aria-label="Faixa anterior" disabled={!current} onClick={onPrevious}><SkipBack /></button>
          <button data-tv-control data-tv-primary type="button" className="tv-now-playing__play" aria-label={playing ? 'Pausar' : 'Tocar'} disabled={!current} onClick={onTogglePlay}>{playing ? <Pause /> : <Play />}</button>
          <button data-tv-control type="button" aria-label="Próxima faixa" disabled={!current} onClick={onNext}><SkipForward /></button>
          <button data-tv-control type="button" aria-label="Repetição" aria-pressed={repeatMode !== 'off'} className={repeatMode !== 'off' ? 'is-active' : ''} disabled={!current} onClick={onRepeat}><Repeat2 /></button>
        </div>
      </section>

      <footer className="tv-now-playing__footer"><div><AudioLines/><span>TOCANDO AGORA</span></div><p>“Good music<br/>makes a better home.”</p></footer>
    </main>
  );
}
