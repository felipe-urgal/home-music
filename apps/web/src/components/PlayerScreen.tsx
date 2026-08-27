import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  GripVertical,
  ListMusic,
  LoaderCircle,
  LogOut,
  MoreVertical,
  Pause,
  Play,
  Repeat1,
  Repeat2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  Wifi
} from 'lucide-react';
import type { NormalizationMode, Playlist, RepeatMode, Track } from '@home-music/shared';
import type {
  DetectedNetwork,
  NetworkPreference,
  StreamingMode,
  StreamingSelection
} from '../streaming-quality';
import { Artwork } from './Artwork';
import { LyricsPanel } from './LyricsPanel';

const QUEUE_PAGE_SIZE = 10;
const TOUCH_DRAG_EDGE_PX = 80;
const TOUCH_DRAG_SCROLL_STEP_PX = 18;

const STREAMING_CHOICES: Array<{ mode: StreamingSelection; label: string; detail: string }> = [
  { mode: 'network', label: 'Por conexão', detail: 'Wi-Fi auto · móvel 96 kbps' },
  { mode: 'auto', label: 'Automática', detail: 'Original + compatibilidade' },
  { mode: 'original', label: 'Original', detail: 'Sem conversão' },
  { mode: 'economy', label: 'Economia', detail: 'AAC · 96 kbps' }
];

const NORMALIZATION_CHOICES: Array<{ mode: NormalizationMode; label: string; detail: string }> = [
  { mode: 'off', label: 'Desativada', detail: 'Reprodução sem ajuste de ganho' },
  { mode: 'track', label: 'Por faixa', detail: 'Volume consistente entre músicas' },
  { mode: 'album', label: 'Por álbum', detail: 'Preserva diferenças dentro do álbum' }
];

const NETWORK_CHOICES: Array<{ preference: NetworkPreference; label: string; detail: string }> = [
  { preference: 'auto', label: 'Detectar', detail: 'Quando o navegador informar' },
  { preference: 'wifi', label: 'Wi-Fi', detail: 'Original + compatibilidade' },
  { preference: 'mobile', label: 'Dados móveis', detail: 'AAC · 96 kbps' }
];

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function artworkTrack(track: Track, offlineMode: boolean): Track {
  return offlineMode && track.hasCover ? { ...track, hasCover: false } : track;
}

function detectedNetworkLabel(network: DetectedNetwork) {
  if (network === 'wifi') return 'Wi-Fi/rede rápida';
  if (network === 'mobile') return 'dados móveis/rede limitada';
  return 'não identificada';
}

function streamingModeLabel(mode: StreamingMode) {
  if (mode === 'economy') return 'Economia · AAC 96 kbps';
  if (mode === 'original') return 'Original';
  return 'Automática · original + compatibilidade';
}

type PlayerScreenProps = {
  current: Track;
  libraryReturnLabel: string;
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  autoplayBlocked: boolean;
  playbackError?: string | null;
  currentTime: number;
  duration: number;
  volume: number;
  usesSystemVolume: boolean;
  shuffle: boolean;
  repeatMode: RepeatMode;
  streamingSelection?: StreamingSelection;
  effectiveStreamingMode?: StreamingMode;
  networkPreference?: NetworkPreference;
  detectedNetwork?: DetectedNetwork;
  normalizationMode?: NormalizationMode;
  effectiveNormalizationMode?: NormalizationMode;
  playlists: Playlist[];
  offlineMode?: boolean;
  isDownloaded?: boolean;
  downloading?: boolean;
  onOpenLibrary: () => void;
  onTogglePlay: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onStreamingSelection?: (selection: StreamingSelection) => void;
  onNetworkPreference?: (preference: NetworkPreference) => void;
  onNormalizationMode?: (mode: NormalizationMode) => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onToggleDownload?: () => void;
  onPlayTrack: (track: Track, context: Track[]) => void;
  onReorderQueue: (from: number, to: number) => void;
  onAddToPlaylist: (playlist: Playlist) => void;
  onLogout: () => void;
  onExitOffline?: () => void;
};

export function PlayerScreen({
  current,
  libraryReturnLabel,
  queue,
  currentIndex,
  playing,
  autoplayBlocked,
  playbackError,
  currentTime,
  duration,
  volume,
  usesSystemVolume,
  shuffle,
  repeatMode,
  streamingSelection = 'auto',
  effectiveStreamingMode = 'auto',
  networkPreference = 'auto',
  detectedNetwork = 'unknown',
  normalizationMode = 'off',
  effectiveNormalizationMode = 'off',
  playlists,
  offlineMode = false,
  isDownloaded = false,
  downloading = false,
  onOpenLibrary,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onStreamingSelection,
  onNetworkPreference,
  onNormalizationMode,
  onShuffle,
  onRepeat,
  onToggleDownload,
  onPlayTrack,
  onReorderQueue,
  onAddToPlaylist,
  onLogout,
  onExitOffline
}: PlayerScreenProps) {
  const [showOptions, setShowOptions] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [visibleQueueCount, setVisibleQueueCount] = useState(QUEUE_PAGE_SIZE);
  const queueLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const touchDragIndexRef = useRef<number | null>(null);
  const touchPointerIdRef = useRef<number | null>(null);
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const hasNext = currentIndex < queue.length - 1 || repeatMode === 'all';
  const visibleStart = Math.max(0, currentIndex);
  const visibleEnd = Math.min(queue.length, visibleStart + visibleQueueCount);
  const visibleQueue = queue.slice(visibleStart, visibleEnd);
  const hasMoreQueueItems = visibleEnd < queue.length;
  const remainingQueueCount = Math.max(0, queue.length - visibleStart - 1);

  useEffect(() => {
    setVisibleQueueCount(QUEUE_PAGE_SIZE);
    setShowQueue(false);
  }, [current.id, queue.length]);

  useEffect(() => {
    const target = queueLoadMoreRef.current;
    if (!target || !hasMoreQueueItems) return;

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleQueueCount(Math.max(QUEUE_PAGE_SIZE, queue.length - visibleStart));
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleQueueCount(count => Math.min(queue.length - visibleStart, count + QUEUE_PAGE_SIZE));
      }
    }, {
      root: null,
      rootMargin: '320px 0px',
      threshold: 0
    });

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreQueueItems, queue.length, visibleStart, visibleEnd]);

  function dropQueue(event: DragEvent, to: number) {
    event.preventDefault();
    if (dragFrom != null) onReorderQueue(dragFrom, to);
    setDragFrom(null);
  }

  function beginTouchReorder(event: ReactPointerEvent<HTMLButtonElement>, queueIndex: number) {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    touchPointerIdRef.current = event.pointerId;
    touchDragIndexRef.current = queueIndex;
    setDragFrom(queueIndex);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveTouchReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    if (touchPointerIdRef.current !== event.pointerId || touchDragIndexRef.current == null) return;
    event.preventDefault();

    if (event.clientY < TOUCH_DRAG_EDGE_PX) {
      window.scrollBy(0, -TOUCH_DRAG_SCROLL_STEP_PX);
    } else if (event.clientY > window.innerHeight - TOUCH_DRAG_EDGE_PX) {
      window.scrollBy(0, TOUCH_DRAG_SCROLL_STEP_PX);
    }

    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-queue-index]') as HTMLElement | null;
    if (!target) return;

    const to = Number(target.dataset.queueIndex);
    const from = touchDragIndexRef.current;
    if (!Number.isInteger(to) || to < 0 || to >= queue.length || to === from) return;

    onReorderQueue(from, to);
    touchDragIndexRef.current = to;
    setDragFrom(to);
  }

  function finishTouchReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    if (touchPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    touchPointerIdRef.current = null;
    touchDragIndexRef.current = null;
    setDragFrom(null);
  }

  return (
    <>
      <header className="topbar">
        <button className="icon-button topbar__back-to-library" aria-label={libraryReturnLabel} title={libraryReturnLabel} onClick={onOpenLibrary}>
          <ChevronDown />
        </button>
        <span className="topbar__title">{offlineMode ? 'Tocando offline' : 'Tocando agora'}</span>
        <button className="icon-button" aria-label="Mais opções" onClick={() => setShowOptions(value => !value)}><MoreVertical /></button>
      </header>

      {showOptions && (
        <div className="player-options">
          {offlineMode ? (
            <>
              <strong>Modo offline</strong>
              <span>Somente as músicas baixadas neste dispositivo entram na fila.</span>
              <div className="player-options__divider" />
              <button className="player-options__logout" onClick={() => { setShowOptions(false); onExitOffline?.(); }}>
                <Wifi /> Tentar conectar
              </button>
            </>
          ) : (
            <>
              {onToggleDownload && (
                <>
                  <strong>Offline</strong>
                  <button
                    disabled={downloading}
                    onClick={() => {
                      onToggleDownload();
                      setShowOptions(false);
                    }}
                  >
                    {downloading ? 'Baixando…' : isDownloaded ? 'Remover download offline' : 'Baixar para uso offline'}
                  </button>
                  <div className="player-options__divider" />
                </>
              )}

              {onStreamingSelection && (
                <>
                  <strong>Qualidade de transmissão</strong>
                  <div className="player-options__choices" role="group" aria-label="Qualidade de transmissão">
                    {STREAMING_CHOICES.map(choice => (
                      <button
                        key={choice.mode}
                        className={`player-options__choice ${streamingSelection === choice.mode ? 'is-selected' : ''}`}
                        aria-pressed={streamingSelection === choice.mode}
                        onClick={() => onStreamingSelection(choice.mode)}
                      >
                        <div className="player-options__choice-copy">
                          <b>{choice.label}</b>
                          <small>{choice.detail}</small>
                        </div>
                        {streamingSelection === choice.mode && <CheckCircle2 aria-hidden="true" />}
                      </button>
                    ))}
                  </div>

                  {streamingSelection === 'network' && onNetworkPreference && (
                    <>
                      <strong>Conexão atual</strong>
                      <div className="player-options__choices" role="group" aria-label="Perfil de conexão atual">
                        {NETWORK_CHOICES.map(choice => (
                          <button
                            key={choice.preference}
                            className={`player-options__choice ${networkPreference === choice.preference ? 'is-selected' : ''}`}
                            aria-pressed={networkPreference === choice.preference}
                            onClick={() => onNetworkPreference(choice.preference)}
                          >
                            <div className="player-options__choice-copy">
                              <b>{choice.label}</b>
                              <small>{choice.detail}</small>
                            </div>
                            {networkPreference === choice.preference && <CheckCircle2 aria-hidden="true" />}
                          </button>
                        ))}
                      </div>
                      <span>
                        Rede detectada: {detectedNetworkLabel(detectedNetwork)}. Perfil efetivo: {streamingModeLabel(effectiveStreamingMode)}.
                      </span>
                      {networkPreference === 'auto' && detectedNetwork === 'unknown' && (
                        <span>Este navegador não informa o tipo de rede com segurança. No iPhone/Safari, escolha Wi-Fi ou Dados móveis manualmente.</span>
                      )}
                    </>
                  )}

                  {streamingSelection === 'auto' && (
                    <span>Automática mantém o original e usa AAC apenas se o navegador não conseguir reproduzir a faixa.</span>
                  )}
                  <div className="player-options__divider" />
                </>
              )}

              {onNormalizationMode && (
                <>
                  <strong>Normalização de volume</strong>
                  <div className="player-options__choices" role="group" aria-label="Normalização de volume">
                    {NORMALIZATION_CHOICES.map(choice => {
                      const unavailable = choice.mode === 'track'
                        ? current.replayGainTrackDb == null
                        : choice.mode === 'album'
                          ? current.replayGainAlbumDb == null && current.replayGainTrackDb == null
                          : false;
                      return (
                        <button
                          key={choice.mode}
                          className={`player-options__choice ${normalizationMode === choice.mode ? 'is-selected' : ''}`}
                          aria-pressed={normalizationMode === choice.mode}
                          disabled={unavailable}
                          onClick={() => onNormalizationMode(choice.mode)}
                        >
                          <div className="player-options__choice-copy">
                            <b>{choice.label}</b>
                            <small>{unavailable ? 'Esta faixa não possui tags ReplayGain' : choice.detail}</small>
                          </div>
                          {normalizationMode === choice.mode && <CheckCircle2 aria-hidden="true" />}
                        </button>
                      );
                    })}
                  </div>
                  {normalizationMode !== 'off' && effectiveNormalizationMode === 'off' && (
                    <span>A preferência continua salva, mas esta faixa será reproduzida sem normalização porque não possui tags ReplayGain.</span>
                  )}
                  {effectiveNormalizationMode !== 'off' && (
                    <span>A normalização usa FFmpeg e o cache local, sem modificar o arquivo original.</span>
                  )}
                  <div className="player-options__divider" />
                </>
              )}

              <strong>Adicionar à playlist</strong>
              {playlists.length ? playlists.map(playlist => (
                <button key={playlist.id} onClick={() => { onAddToPlaylist(playlist); setShowOptions(false); }}>
                  {playlist.name}
                </button>
              )) : <span>Nenhuma playlist criada ainda.</span>}
              <div className="player-options__divider" />
              <button className="player-options__logout" onClick={() => { setShowOptions(false); onLogout(); }}>
                <LogOut /> Sair
              </button>
            </>
          )}
        </div>
      )}

      <div className="hero-art"><Artwork track={artworkTrack(current, offlineMode)} large /></div>

      <div className="track-heading">
        <div>
          <h1>{current.title}</h1>
          <p>{current.artist}</p>
        </div>
        <div className="track-heading__actions">
          {!offlineMode && onToggleDownload && (
            <button
              className={`icon-button icon-button--large ${isDownloaded ? 'is-downloaded' : ''}`}
              aria-label={downloading ? 'Baixando para uso offline' : isDownloaded ? 'Remover download offline' : 'Baixar para uso offline'}
              disabled={downloading}
              onClick={onToggleDownload}
            >
              {downloading ? <LoaderCircle className="download-spinner" /> : isDownloaded ? <CheckCircle2 /> : <Download />}
            </button>
          )}
        </div>
      </div>

      {offlineMode && <div className="player-offline-status"><Download /> Reproduzindo o arquivo salvo neste dispositivo.</div>}

      {autoplayBlocked && (
        <div className="autoplay-notice" role="status">
          O navegador bloqueou o play automático. Toque em Play uma vez para continuar.
        </div>
      )}

      {playbackError && <div className="autoplay-notice" role="alert">{playbackError}</div>}

      <div className="progress-wrap">
        <input
          aria-label="Progresso da música"
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          style={{ '--progress': `${progress}%` } as CSSProperties}
          onChange={event => onSeek(Number(event.target.value))}
        />
        <div className="time-row"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
      </div>

      <div className="controls">
        <button className={`icon-button ${shuffle ? 'is-active' : ''}`} aria-label="Aleatório" aria-pressed={shuffle} onClick={onShuffle}><Shuffle /></button>
        <button className="icon-button icon-button--control" aria-label="Anterior" onClick={onPrevious}><SkipBack /></button>
        <button className="play-button" aria-label={playing ? 'Pausar' : 'Tocar'} onClick={onTogglePlay}>
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="icon-button icon-button--control" aria-label="Próxima" onClick={onNext} disabled={!hasNext}><SkipForward /></button>
        <button
          className={`icon-button ${repeatMode !== 'off' ? 'is-active' : ''}`}
          aria-label={repeatMode === 'one' ? 'Repetir uma' : repeatMode === 'all' ? 'Repetir fila' : 'Repetição desligada'}
          onClick={onRepeat}
        >
          {repeatMode === 'one' ? <Repeat1 /> : <Repeat2 />}
        </button>
      </div>

      {!usesSystemVolume && (
        <div className="volume-control">
          <Volume2 aria-hidden="true" />
          <input
            aria-label="Volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={event => onVolume(Number(event.target.value))}
          />
          <span>{Math.round(volume * 100)}%</span>
        </div>
      )}

      <LyricsPanel track={current} currentTime={currentTime} offlineMode={offlineMode} />

      <section className="queue-panel queue-panel--player">
        <button
          type="button"
          className="queue-panel__toggle"
          aria-expanded={showQueue}
          onClick={() => setShowQueue(value => !value)}
        >
          <span><ListMusic aria-hidden="true" /> A seguir <small>· {remainingQueueCount} músicas</small></span>
          {showQueue ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
        <div className={`queue-panel__content ${showQueue ? 'is-open' : ''}`}>
          <div className="queue-label">Fila · {queue.length} músicas · arraste ou use as setas</div>
          <div className="queue-list">
            {visibleQueue.map((track, visibleIndex) => {
              const queueIndex = visibleStart + visibleIndex;
              const isCurrent = track.id === current.id;
              const isDragging = dragFrom === queueIndex;
              return (
                <div
                  className={`queue-item queue-item--reorder ${isCurrent ? 'is-current' : ''} ${isDragging ? 'is-dragging' : ''}`}
                  key={track.id}
                  data-queue-index={queueIndex}
                  draggable={!isCurrent}
                  onDragStart={() => setDragFrom(queueIndex)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => dropQueue(event, queueIndex)}
                  onDragEnd={() => setDragFrom(null)}
                >
                  <button
                    type="button"
                    className="queue-drag-handle"
                    aria-label={isCurrent ? 'Faixa atual' : `Arrastar ${track.title}`}
                    disabled={isCurrent}
                    onPointerDown={event => beginTouchReorder(event, queueIndex)}
                    onPointerMove={moveTouchReorder}
                    onPointerUp={finishTouchReorder}
                    onPointerCancel={finishTouchReorder}
                  >
                    <GripVertical className="queue-drag" aria-hidden="true" />
                  </button>
                  <button className="queue-item__main" onClick={() => onPlayTrack(track, queue)}>
                    <Artwork track={artworkTrack(track, offlineMode)} />
                    <span className="queue-item__text"><strong>{track.title}</strong><small>{track.artist}</small></span>
                  </button>
                  <div className="queue-reorder-buttons">
                    <button aria-label="Mover para cima" disabled={queueIndex === 0} onClick={() => onReorderQueue(queueIndex, queueIndex - 1)}><ChevronUp /></button>
                    <button aria-label="Mover para baixo" disabled={queueIndex === queue.length - 1} onClick={() => onReorderQueue(queueIndex, queueIndex + 1)}><ChevronDown /></button>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMoreQueueItems && <div ref={queueLoadMoreRef} className="queue-load-more" aria-hidden="true" />}
        </div>
      </section>
    </>
  );
}
