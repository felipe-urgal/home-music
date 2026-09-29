import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { Track, TrackHotCues, TrackRhythmOverride, TrackWaveform } from '@home-music/shared';
import {
  ArrowLeft,
  Cable,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Gauge,
  Folder,
  Keyboard,
  LayoutGrid,
  Library,
  List,
  ListMusic,
  MoreVertical,
  Music,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings,
  Shuffle,
  SlidersHorizontal,
  Upload,
  Zap,
} from 'lucide-react';
import { apiFetch } from '../api-client';
import type { DjDeckId } from '../dj-controller-contract';
import { DJ_EQ_GAIN_DB, type DjEqControl } from '../dj-eq';
import type { DjFxKind } from '../dj-fx';
import { buildDjWaveformMarkers } from '../dj-waveform-grid';
import { resolveHotCuePosition } from '../dj-hot-cue-quantize';
import { buildDjHotCueWaveformMarkers } from '../dj-hot-cue-waveform';
import { djLoopWaveformRange, resolveDjAutoLoopPlan } from '../dj-auto-loop';
import { resolveDjHotLoopPlan } from '../dj-hot-loop';
import { notifyLibraryChanged } from '../library-events';
import { fetchTrackWaveform } from '../track-waveform-client';
import type { DualDeckAudioSnapshot } from '../dual-deck-audio';
import type { DualDeckMixerState } from '../dual-deck-mixer';
import type { WebMidiController } from '../useWebMidiController';
import { Artwork } from './Artwork';

export type DjDeckPanelState = {
  snapshot: DualDeckAudioSnapshot | null;
  track: Track | null;
  cuePointSeconds: number | null;
  syncActive: boolean;
  syncMaster: boolean;
  syncMode: 'off' | 'tempo' | 'beat' | 'bar';
  channelVolume: number;
  meterLevel: number;
};

type DjModeScreenProps = {
  decks: Record<DjDeckId, DjDeckPanelState>;
  mixer: DualDeckMixerState;
  libraryTracks: Track[];
  librarySources: Array<{ value: string; label: string; group: 'all' | 'folder' | 'playlist' }>;
  selectedLibrarySource: string;
  onSelectLibrarySource: (value: string) => void;
  selectedLibraryIndex: number;
  onSelectLibraryIndex: (index: number) => void;
  automixShuffle: boolean;
  onAutomixShuffleChange: (value: boolean) => void;
  playedTrackIds: Set<string>;
  automixCurrentTrackId: string | null;
  automixNextTrackId: string | null;
  onLoadSelectedTrack: (deck: DjDeckId) => void;
  midi: WebMidiController;
  onDisconnectMidi: () => void;
  onSelectMidiOutput: (id: string | null) => boolean;
  onChannelVolume: (deck: DjDeckId, value: number) => void;
  onEq: (deck: DjDeckId, control: DjEqControl, value: number) => void;
  onFxEnabled: (deck: DjDeckId, kind: DjFxKind, enabled: boolean) => void;
  onFxWet: (deck: DjDeckId, kind: DjFxKind, wet: number) => void;
  onEchoFeedback: (deck: DjDeckId, feedback: number) => void;
  onEchoDelay: (deck: DjDeckId, delaySeconds: number) => void;
  onCrossfader: (value: number) => void;
  onTogglePlay: (deck: DjDeckId) => void;
  onCue: (deck: DjDeckId) => void;
  onSync: (deck: DjDeckId) => void;
  onTempo: (deck: DjDeckId, playbackRate: number) => void;
  onNudge: (deck: DjDeckId, delta: -1 | 1) => void;
  onSeek: (deck: DjDeckId, seconds: number) => void;
  mixMode: 'manual' | 'automix';
  onMixModeChange: (mode: 'manual' | 'automix') => void;
  onExit: () => void;
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function pitchPercent(playbackRate: number) {
  return (playbackRate - 1) * 100;
}

function drawDjWaveform(
  canvas: HTMLCanvasElement,
  waveform: TrackWaveform | null,
  rhythm: Track['rhythm'],
  durationSeconds: number,
  deck: DjDeckId
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const accent = deck === 'a' ? '#1498ff' : '#ffd51f';
  const centerY = height / 2;

  if (waveform?.peaks.length) {
    const columns = Math.max(1, Math.min(Math.floor(width), waveform.peaks.length));
    const columnWidth = width / columns;
    context.fillStyle = accent;
    context.globalAlpha = 0.9;

    for (let column = 0; column < columns; column += 1) {
      const start = Math.floor((column * waveform.peaks.length) / columns);
      const end = Math.max(
        start + 1,
        Math.floor(((column + 1) * waveform.peaks.length) / columns)
      );
      let peak = 0;
      for (let index = start; index < end && index < waveform.peaks.length; index += 1) {
        peak = Math.max(peak, waveform.peaks[index] ?? 0);
      }

      const barHeight = Math.max(1, peak * (height * 0.78));
      const x = column * columnWidth;
      const barWidth = Math.max(1, columnWidth * 0.72);
      context.fillRect(x, centerY - (barHeight / 2), barWidth, barHeight);
    }
  } else {
    context.strokeStyle = 'rgba(190, 205, 226, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, centerY);
    context.lineTo(width, centerY);
    context.stroke();
  }

  const duration = waveform?.durationSeconds ?? durationSeconds;
  const markers = buildDjWaveformMarkers(rhythm, duration);
  for (const marker of markers) {
    const x = marker.position * width;
    context.strokeStyle = marker.kind === 'downbeat'
      ? 'rgba(255, 255, 255, 0.58)'
      : 'rgba(255, 255, 255, 0.18)';
    context.lineWidth = marker.kind === 'downbeat' ? 1.4 : 0.7;
    context.beginPath();
    context.moveTo(x, marker.kind === 'downbeat' ? 3 : height * 0.28);
    context.lineTo(x, marker.kind === 'downbeat' ? height - 3 : height * 0.72);
    context.stroke();
  }

  context.globalAlpha = 1;
}

function DjWaveform({
  deck,
  track,
  progress,
  currentTimeSeconds,
  hotCues,
  loopIn,
  loopOut,
  loopActive,
  hotLoopCueIndex,
  onSeek,
  onHotCueSeek
}: {
  deck: DjDeckId;
  track: Track;
  progress: number;
  currentTimeSeconds: number;
  hotCues: TrackHotCues['positions'];
  loopIn: number | null;
  loopOut: number | null;
  loopActive: boolean;
  hotLoopCueIndex: number | null;
  onSeek: (seconds: number) => void;
  onHotCueSeek: (seconds: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waveform, setWaveform] = useState<TrackWaveform | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'ready' | 'unavailable'>('loading');
  const durationSeconds = waveform?.durationSeconds ?? track.duration ?? 0;
  const hotCueMarkers = useMemo(
    () => buildDjHotCueWaveformMarkers(hotCues, durationSeconds),
    [durationSeconds, hotCues]
  );
  const loopRange = useMemo(
    () => djLoopWaveformRange({ loopIn, loopOut, durationSeconds }),
    [durationSeconds, loopIn, loopOut]
  );

  useEffect(() => {
    let active = true;
    let retryTimer: number | null = null;
    setWaveform(null);
    setStatus('loading');

    const load = async () => {
      const result = await fetchTrackWaveform(track.id);
      if (!active) return;
      if (result.status === 'ready') {
        setWaveform(result.waveform);
        setStatus('ready');
        return;
      }
      setWaveform(null);
      setStatus(result.status);
      if (result.status === 'pending') {
        retryTimer = window.setTimeout(() => {
          if (active) void load();
        }, 3_000);
      }
    };

    void load();
    return () => {
      active = false;
      if (retryTimer != null) window.clearTimeout(retryTimer);
    };
  }, [track.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => drawDjWaveform(
      canvas,
      waveform,
      track.rhythm,
      track.duration ?? 0,
      deck
    );
    render();

    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(render);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [deck, track.duration, track.rhythm, waveform]);

  const seekFromPointer = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (durationSeconds <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(ratio * durationSeconds);
  };

  const seekFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (durationSeconds <= 0) return;
    const step = event.shiftKey ? 10 : 5;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      onSeek(Math.max(0, currentTimeSeconds - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      onSeek(Math.min(durationSeconds, currentTimeSeconds + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      onSeek(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      onSeek(durationSeconds);
    }
  };

  return (
    <div className="dj-waveform" data-status={status} aria-label="Waveform real da faixa">
      <canvas ref={canvasRef} className="dj-waveform__canvas" aria-hidden="true" />
      <div
        className="dj-waveform__seek-surface"
        role="slider"
        tabIndex={0}
        aria-label={'Buscar posição no waveform ' + (deck === 'a' ? 'Deck A' : 'Deck B')}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, durationSeconds)}
        aria-valuenow={Math.max(0, Math.min(durationSeconds, currentTimeSeconds))}
        aria-valuetext={formatTime(currentTimeSeconds) + ' de ' + formatTime(durationSeconds)}
        onClick={seekFromPointer}
        onKeyDown={seekFromKeyboard}
      />
      <span className="dj-waveform__remaining" style={{ left: `${progress}%` }} aria-hidden="true" />
      {loopRange && (
        <span
          className="dj-waveform__loop-range"
          data-active={loopActive ? 'true' : 'false'}
          style={{
            left: `${loopRange.start * 100}%`,
            width: `${(loopRange.end - loopRange.start) * 100}%`
          }}
          aria-label={loopActive ? 'Loop ativo no waveform' : 'Loop salvo no waveform'}
        />
      )}
      {hotCueMarkers.map(marker => (
        <button
          key={marker.index}
          type="button"
          className="dj-waveform__hot-cue"
          data-hot-loop={hotLoopCueIndex === marker.index && loopActive ? 'true' : 'false'}
          style={{ left: `clamp(11px, ${marker.position * 100}%, calc(100% - 11px))` }}
          aria-label={'Hot Cue ' + (marker.index + 1) + ' no waveform ' + (deck === 'a' ? 'Deck A' : 'Deck B')}
          title={'Hot Cue ' + (marker.index + 1) + ' · ' + formatTime(marker.seconds)}
          onClick={() => onHotCueSeek(marker.seconds)}
        >
          {marker.index + 1}
        </button>
      ))}
      <span className="dj-waveform__playhead" style={{ left: `${progress}%` }} aria-hidden="true" />
      <span className="dj-waveform__time dj-waveform__time--elapsed" aria-hidden="true">
        {formatTime(currentTimeSeconds)}
      </span>
      <span className="dj-waveform__time dj-waveform__time--remaining" aria-hidden="true">
        {durationSeconds > 0 ? '-' + formatTime(Math.max(0, durationSeconds - currentTimeSeconds)) : '0:00'}
      </span>
      {status !== 'ready' && (
        <span className="dj-waveform__status">
          {status === 'loading'
            ? 'Carregando waveform…'
            : status === 'pending'
              ? 'Waveform em análise'
              : 'Waveform indisponível'}
        </span>
      )}
    </div>
  );
}

function DeckPanel({
  deck,
  state,
  onTogglePlay,
  onCue,
  onSync,
  onTempo,
  onNudge,
  onSeek
}: {
  deck: DjDeckId;
  state: DjDeckPanelState;
  onTogglePlay: (deck: DjDeckId) => void;
  onCue: (deck: DjDeckId) => void;
  onSync: (deck: DjDeckId) => void;
  onTempo: (deck: DjDeckId, playbackRate: number) => void;
  onNudge: (deck: DjDeckId, delta: -1 | 1) => void;
  onSeek: (deck: DjDeckId, seconds: number) => void;
}) {
  const label = deck === 'a' ? 'Deck A' : 'Deck B';
  const side = deck === 'a' ? 'Esquerdo' : 'Direito';
  const snapshot = state.snapshot;
  const loaded = Boolean(snapshot?.trackId && state.track);
  const playing = Boolean(snapshot?.playing);
  const progress = snapshot?.durationSeconds
    ? Math.max(0, Math.min(100, (snapshot.currentTimeSeconds / snapshot.durationSeconds) * 100))
    : 0;
  const bpm = state.track?.rhythm?.bpm ?? null;
  const rate = snapshot?.playbackRate ?? 1;
  const [jogMode, setJogMode] = useState<'vinyl' | 'slip'>('vinyl');
  const [loopIn, setLoopIn] = useState<number | null>(null);
  const [loopOut, setLoopOut] = useState<number | null>(null);
  const [loopActive, setLoopActive] = useState(false);
  const [loopBeats, setLoopBeats] = useState(4);
  const [hotLoopCueIndex, setHotLoopCueIndex] = useState<number | null>(null);
  const [hotCues, setHotCues] = useState<TrackHotCues['positions']>([null, null, null, null]);
  const [hotCueQuantize, setHotCueQuantize] = useState(false);
  const [hotCueError, setHotCueError] = useState<string | null>(null);
  const hotCueSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const persistedHotCuesKey = JSON.stringify(state.track?.hotCues?.positions ?? [null, null, null, null]);

  useEffect(() => {
    setLoopIn(null);
    setLoopOut(null);
    setLoopActive(false);
    setLoopBeats(4);
    setHotLoopCueIndex(null);
  }, [snapshot?.trackId]);

  useEffect(() => {
    setHotCues([...(state.track?.hotCues?.positions ?? [null, null, null, null])] as TrackHotCues['positions']);
    setHotCueError(null);
  }, [snapshot?.trackId, persistedHotCuesKey]);

  useEffect(() => {
    if (!loopActive || loopIn == null || loopOut == null || !snapshot?.trackId) return;
    if (snapshot.currentTimeSeconds >= loopOut) onSeek(deck, loopIn);
  }, [deck, loopActive, loopIn, loopOut, onSeek, snapshot?.currentTimeSeconds, snapshot?.trackId]);

  const applyAutoLoop = (beats = loopBeats) => {
    if (!snapshot?.trackId) return;
    const plan = resolveDjAutoLoopPlan({
      positionSeconds: snapshot.currentTimeSeconds,
      durationSeconds: snapshot.durationSeconds || state.track?.duration,
      rhythm: state.track?.rhythm,
      beats
    });
    if (!plan) return;
    setLoopIn(plan.startSeconds);
    setLoopOut(plan.endSeconds);
    setLoopActive(true);
    setHotLoopCueIndex(null);
  };

  const changeLoopBeats = (direction: -1 | 1) => {
    const sizes = [1, 2, 4, 8, 16];
    const current = sizes.indexOf(loopBeats);
    const next = sizes[Math.max(0, Math.min(sizes.length - 1, current + direction))] ?? 4;
    setLoopBeats(next);
    if (loopIn != null && loopOut != null) {
      const bpmAtLoop = state.track?.rhythm
        ? (60 / Math.max(0.001, (loopOut - loopIn) / loopBeats))
        : bpm;
      if (bpmAtLoop) {
        const duration = snapshot?.durationSeconds || state.track?.duration || Number.POSITIVE_INFINITY;
        setLoopOut(Math.min(duration, loopIn + ((60 / bpmAtLoop) * next)));
      }
    }
  };

  const setLoopStart = () => {
    if (!snapshot?.trackId) return;
    const startSeconds = snapshot.currentTimeSeconds;
    setLoopIn(startSeconds);
    setHotLoopCueIndex(null);
    if (bpm) {
      const duration = snapshot.durationSeconds || state.track?.duration || Number.POSITIVE_INFINITY;
      setLoopOut(Math.min(duration, startSeconds + ((60 / bpm) * loopBeats)));
      setLoopActive(true);
    } else {
      setLoopOut(null);
      setLoopActive(false);
    }
  };

  const setLoopEnd = () => {
    if (!snapshot?.trackId || loopIn == null) return;
    const endSeconds = snapshot.currentTimeSeconds;
    if (endSeconds <= loopIn + 0.05) return;
    setLoopOut(endSeconds);
    setLoopActive(true);
    setHotLoopCueIndex(null);
  };

  const handleJog = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!snapshot?.trackId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const direction: -1 | 1 = event.clientX < rect.left + (rect.width / 2) ? -1 : 1;
    if (jogMode === 'vinyl') {
      onSeek(deck, Math.max(0, snapshot.currentTimeSeconds + (direction * 0.5)));
    } else {
      onNudge(deck, direction);
    }
  };

  const persistHotCues = (positions: TrackHotCues['positions']) => {
    if (!snapshot?.trackId) return;
    const trackId = snapshot.trackId;
    const payload: TrackHotCues = { version: 1, positions };
    setHotCueError(null);

    hotCueSaveChainRef.current = hotCueSaveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await apiFetch(`/api/tracks/${encodeURIComponent(trackId)}/hot-cues`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Home-Music-Request': '1'
          },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || `Falha HTTP ${response.status}`);
        }
        notifyLibraryChanged();
      })
      .catch(error => {
        setHotCueError(error instanceof Error ? error.message : 'Não foi possível salvar os Hot Cues.');
        notifyLibraryChanged();
      });
  };

  const replaceHotCue = (index: number, value: number | null) => {
    const next = hotCues.map((current, cueIndex) => cueIndex === index ? value : current) as TrackHotCues['positions'];
    setHotCues(next);
    persistHotCues(next);
  };

  const triggerHotCue = (index: number) => {
    if (!snapshot?.trackId) return;
    const cue = hotCues[index];
    if (cue == null) {
      const position = resolveHotCuePosition({
        positionSeconds: snapshot.currentTimeSeconds,
        durationSeconds: snapshot.durationSeconds || state.track?.duration,
        rhythm: state.track?.rhythm,
        quantize: hotCueQuantize
      });
      replaceHotCue(index, position);
      return;
    }
    onSeek(deck, cue);
  };

  const startHotLoop = (index: number) => {
    const cue = hotCues[index];
    if (cue == null || !snapshot?.trackId) return;
    const plan = resolveDjHotLoopPlan({
      cueSeconds: cue,
      durationSeconds: snapshot.durationSeconds || state.track?.duration,
      rhythm: state.track?.rhythm,
      beats: loopBeats
    });
    if (!plan) return;
    setLoopIn(plan.startSeconds);
    setLoopOut(plan.endSeconds);
    setLoopActive(true);
    setHotLoopCueIndex(index);
    onSeek(deck, cue);
  };

  const clearHotCue = (index: number) => {
    if (!snapshot?.trackId) return;
    if (hotLoopCueIndex === index) {
      setLoopActive(false);
      setHotLoopCueIndex(null);
    }
    replaceHotCue(index, null);
  };

  return (
    <article className="dj-pro-deck dj-pro-deck--console" aria-label={label} data-deck={deck} data-playing={playing ? 'true' : 'false'}>
      <div className="dj-pro-deck__heading">
        <div>
          <span className="dj-pro-deck__accent" aria-hidden="true" />
          <strong>{label}</strong>
          <span>{side}</span>
        </div>
        <div className="dj-pro-deck__heading-actions">
          {state.syncMaster && <span className="dj-sync-master-badge">MASTER</span>}
          <MoreVertical aria-hidden="true" />
        </div>
      </div>

      {!loaded ? (
        <div className="dj-pro-deck__empty">
          <Disc3 aria-hidden="true" />
          <strong>Nenhuma faixa carregada</strong>
          <span>Carregue uma faixa pela biblioteca ou pela controladora.</span>
        </div>
      ) : (
        <>
          <div className="dj-pro-deck__track">
            <div className="dj-pro-deck__artwork"><Artwork track={state.track ?? undefined} /></div>
            <div className="dj-pro-deck__track-copy">
              <strong>{state.track?.title}</strong>
              <span>{state.track?.artist || 'Artista desconhecido'}</span>
            </div>
          </div>

          <DjWaveform
            deck={deck}
            track={state.track!}
            progress={progress}
            currentTimeSeconds={snapshot?.currentTimeSeconds ?? 0}
            hotCues={hotCues}
            loopIn={loopIn}
            loopOut={loopOut}
            loopActive={loopActive}
            hotLoopCueIndex={hotLoopCueIndex}
            onSeek={seconds => onSeek(deck, seconds)}
            onHotCueSeek={seconds => onSeek(deck, seconds)}
          />

          <div className="dj-pro-deck__metrics">
            <div><span>BPM</span><strong>{bpm ? bpm.toFixed(1) : '—'}</strong></div>
            <div><span>Pitch</span><strong>{pitchPercent(rate) >= 0 ? '+' : ''}{pitchPercent(rate).toFixed(2)}%</strong></div>
            <div><span>Rate</span><strong>{rate.toFixed(3)}×</strong></div>
            <div><span>Canal</span><strong>{Math.round(state.channelVolume * 100)}%</strong></div>
          </div>

          <div className="dj-deck-performance">
            <label className="dj-tempo-fader">
              <span>TEMPO</span>
              <strong>{pitchPercent(rate) >= 0 ? '+' : ''}{pitchPercent(rate).toFixed(2)}%</strong>
              <input
                aria-label={'Tempo ' + label}
                type="range"
                min="0.94"
                max="1.06"
                step="0.001"
                value={Math.max(0.94, Math.min(1.06, rate))}
                onChange={event => onTempo(deck, Number(event.currentTarget.value))}
              />
              <small>-6</small><small>+6</small>
            </label>

            <button
              type="button"
              className="dj-jog-wheel"
              aria-label={'Jog wheel ' + label}
              onPointerDown={handleJog}
              title={jogMode === 'vinyl' ? 'VINYL: toque à esquerda/direita para scrub' : 'SLIP: toque à esquerda/direita para nudge'}
            >
              <span className="dj-jog-wheel__ring" />
              <span className="dj-jog-wheel__disc">
                <span>{bpm ? bpm.toFixed(1) : '—'}</span>
                <small>BPM</small>
              </span>
            </button>

            <div className="dj-deck-tools">
              <div className="dj-jog-mode" aria-label={'Modo do jog ' + label}>
                <button type="button" className={jogMode === 'vinyl' ? 'is-active' : ''} onClick={() => setJogMode('vinyl')}>VINYL</button>
                <button type="button" className={jogMode === 'slip' ? 'is-active' : ''} onClick={() => setJogMode('slip')}>SLIP</button>
              </div>
              <div className="dj-loop-points">
                <button type="button" className={loopIn != null ? 'is-active' : ''} onClick={setLoopStart}>IN</button>
                <button type="button" className={loopOut != null ? 'is-active' : ''} onClick={setLoopEnd} disabled={loopIn == null}>OUT</button>
              </div>
              <div className="dj-loop-size">
                <button type="button" aria-label={'Diminuir loop ' + label} onClick={() => changeLoopBeats(-1)}><ChevronLeft aria-hidden="true" /></button>
                <button
                  type="button"
                  className={loopActive ? 'is-active' : ''}
                  onClick={() => {
                    if (loopIn != null && loopOut != null) {
                      setLoopActive(value => !value);
                    } else {
                      applyAutoLoop();
                    }
                  }}
                  aria-pressed={loopActive}
                  aria-label={'Auto Loop ' + loopBeats + ' beats ' + label}
                  disabled={bpm == null && (loopIn == null || loopOut == null)}
                  title={
                    loopIn != null && loopOut != null
                      ? 'Ativar/desativar loop'
                      : bpm == null
                        ? 'Auto Loop requer BPM analisado'
                        : 'Criar Auto Loop quantizado'
                  }
                >
                  {loopBeats}
                </button>
                <button type="button" aria-label={'Aumentar loop ' + label} onClick={() => changeLoopBeats(1)}><ChevronRight aria-hidden="true" /></button>
              </div>
            </div>
          </div>

          <div className="dj-hot-cues" aria-label={'Hot Cues ' + label}>
            <div className="dj-hot-cues__toolbar">
              <span>HOT CUES</span>
              <button
                type="button"
                className={hotCueQuantize ? 'is-active' : ''}
                aria-pressed={hotCueQuantize}
                aria-label={'QUANTIZE Hot Cues ' + label}
                onClick={() => setHotCueQuantize(value => !value)}
                title="Encaixar novos Hot Cues na batida mais próxima"
              >
                QUANTIZE
              </button>
            </div>
            {hotCues.map((cue, index) => (
              <div className="dj-hot-cue" key={index} data-set={cue == null ? 'false' : 'true'}>
                <button
                  type="button"
                  className="dj-hot-cue__pad"
                  onClick={() => triggerHotCue(index)}
                  aria-label={(cue == null ? 'Definir' : 'Ir para') + ' Hot Cue ' + (index + 1) + ' ' + label}
                  title={cue == null ? 'Salvar posição atual' : 'Ir para ' + formatTime(cue)}
                >
                  <strong>{index + 1}</strong>
                  <span>{cue == null ? 'SET' : formatTime(cue)}</span>
                </button>
                <button
                  type="button"
                  className="dj-hot-cue__loop"
                  onClick={() => startHotLoop(index)}
                  disabled={cue == null || bpm == null}
                  aria-pressed={hotLoopCueIndex === index && loopActive}
                  aria-label={'Hot Loop Hot Cue ' + (index + 1) + ' ' + label}
                  title={bpm == null ? 'Hot Loop requer BPM analisado' : 'Criar Hot Loop com ' + loopBeats + ' beats'}
                >
                  LOOP
                </button>
                <button
                  type="button"
                  className="dj-hot-cue__clear"
                  onClick={() => clearHotCue(index)}
                  disabled={cue == null}
                  aria-label={'Limpar Hot Cue ' + (index + 1) + ' ' + label}
                  title="Limpar Hot Cue"
                >
                  ×
                </button>
              </div>
            ))}
            {hotCueError && <span className="dj-hot-cues__error" role="status">{hotCueError}</span>}
          </div>

          <div className="dj-pro-deck__controls">
            <button
              type="button"
              className={playing ? 'is-primary' : ''}
              onClick={() => onTogglePlay(deck)}
              aria-label={playing ? 'Pausar ' + label : 'Reproduzir ' + label}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button type="button" onClick={() => onCue(deck)}>
              <RotateCcw aria-hidden="true" /><span>CUE</span>
            </button>
            <button
              type="button"
              className={state.syncActive ? 'is-active' : ''}
              onClick={() => onSync(deck)}
              aria-pressed={state.syncActive}
              title={state.syncActive ? 'SYNC ativo (' + state.syncMode + ')' : 'Ativar SYNC'}
            >
              <Zap aria-hidden="true" />
              <span>{state.syncActive ? 'SYNC · ' + state.syncMode.toUpperCase() : 'SYNC'}</span>
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function RhythmGridEditor({
  track,
  onClose
}: {
  track: Track;
  onClose: () => void;
}) {
  const [bpm, setBpm] = useState(String(track.rhythm?.bpm ?? 120));
  const [firstBeatSeconds, setFirstBeatSeconds] = useState(String(track.rhythm?.firstBeatSeconds ?? 0));
  const [downbeatSeconds, setDownbeatSeconds] = useState(
    track.rhythm?.downbeatSeconds == null ? '' : String(track.rhythm.downbeatSeconds)
  );
  const [beatsPerBar, setBeatsPerBar] = useState<3 | 4>(track.rhythm?.beatsPerBar === 3 ? 3 : 4);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bpmValue = Number(bpm);
  const firstBeatValue = Number(firstBeatSeconds);
  const downbeatValue = downbeatSeconds.trim() === '' ? null : Number(downbeatSeconds);
  const valid = (
    Number.isFinite(bpmValue)
    && bpmValue >= 20
    && bpmValue <= 300
    && Number.isFinite(firstBeatValue)
    && firstBeatValue >= 0
    && (downbeatValue == null || (Number.isFinite(downbeatValue) && downbeatValue >= 0))
  );
  const previewTrack: Track = {
    ...track,
    rhythm: valid
      ? {
          bpm: bpmValue,
          firstBeatSeconds: firstBeatValue,
          confidence: 1,
          manualOverride: true,
          ...(downbeatValue == null
            ? {}
            : {
                downbeatSeconds: downbeatValue,
                beatsPerBar,
                downbeatConfidence: 1
              })
        }
      : track.rhythm
  };

  const mutate = async (method: 'PUT' | 'DELETE') => {
    if (method === 'PUT' && !valid) {
      setError('Revise BPM e posições do grid.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const override: TrackRhythmOverride = {
        version: 1,
        bpm: bpmValue,
        firstBeatSeconds: firstBeatValue,
        ...(downbeatValue == null
          ? {}
          : { downbeatSeconds: downbeatValue, beatsPerBar })
      };
      const response = await apiFetch(`/api/tracks/${encodeURIComponent(track.id)}/rhythm-override`, {
        method,
        headers: {
          'X-Home-Music-Request': '1',
          ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {})
        },
        ...(method === 'PUT' ? { body: JSON.stringify(override) } : {})
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || `Falha HTTP ${response.status}`);
      }
      notifyLibraryChanged();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o beat grid.');
    } finally {
      setSaving(false);
    }
  };

  const shift = (delta: number) => {
    const current = Number(firstBeatSeconds);
    if (!Number.isFinite(current)) return;
    setFirstBeatSeconds(String(Math.max(0, Number((current + delta).toFixed(3)))));
    if (downbeatSeconds.trim() !== '') {
      const downbeat = Number(downbeatSeconds);
      if (Number.isFinite(downbeat)) {
        setDownbeatSeconds(String(Math.max(0, Number((downbeat + delta).toFixed(3)))));
      }
    }
  };

  return (
    <section className="dj-grid-editor" aria-label={`Editar beat grid de ${track.title}`}>
      <div className="dj-grid-editor__heading">
        <div>
          <strong>Beat grid</strong>
          <span>{track.rhythm?.manualOverride ? 'Correção manual ativa' : 'Análise automática'}</span>
        </div>
        <button type="button" onClick={onClose} disabled={saving}>Fechar</button>
      </div>

      <DjWaveform
        deck="a"
        track={previewTrack}
        progress={0}
        currentTimeSeconds={0}
        hotCues={[null, null, null, null]}
        loopIn={null}
        loopOut={null}
        loopActive={false}
        hotLoopCueIndex={null}
        onSeek={() => undefined}
        onHotCueSeek={() => undefined}
      />

      <div className="dj-grid-editor__fields">
        <label>
          <span>BPM</span>
          <input
            type="number"
            min="20"
            max="300"
            step="0.01"
            value={bpm}
            onChange={event => setBpm(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Primeiro beat (s)</span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={firstBeatSeconds}
            onChange={event => setFirstBeatSeconds(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Downbeat (s)</span>
          <input
            type="number"
            min="0"
            step="0.001"
            value={downbeatSeconds}
            placeholder="Sem downbeat"
            onChange={event => setDownbeatSeconds(event.currentTarget.value)}
          />
        </label>
        <label>
          <span>Compasso</span>
          <select value={beatsPerBar} onChange={event => setBeatsPerBar(Number(event.currentTarget.value) === 3 ? 3 : 4)}>
            <option value="4">4/4</option>
            <option value="3">3/4</option>
          </select>
        </label>
      </div>

      <div className="dj-grid-editor__actions">
        <div>
          <button type="button" onClick={() => shift(-0.01)} disabled={saving}>← 10 ms</button>
          <button type="button" onClick={() => shift(0.01)} disabled={saving}>10 ms →</button>
        </div>
        <div>
          {track.rhythm?.manualOverride && (
            <button type="button" onClick={() => void mutate('DELETE')} disabled={saving}>
              Restaurar automático
            </button>
          )}
          <button type="button" className="is-primary" onClick={() => void mutate('PUT')} disabled={saving || !valid}>
            {saving ? 'Salvando…' : 'Salvar grid'}
          </button>
        </div>
      </div>
      {error && <p className="dj-grid-editor__error" role="alert">{error}</p>}
    </section>
  );
}

function DjLibrary({
  tracks,
  sources,
  selectedLibrarySource,
  onSelectLibrarySource,
  selectedIndex,
  onSelect,
  shuffle,
  onShuffleChange,
  playedTrackIds,
  automixCurrentTrackId,
  automixNextTrackId,
  onLoad,
  loadedTrackIds
}: {
  tracks: Track[];
  sources: Array<{ value: string; label: string; group: 'all' | 'folder' | 'playlist' }>;
  selectedLibrarySource: string;
  onSelectLibrarySource: (value: string) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
  shuffle: boolean;
  onShuffleChange: (value: boolean) => void;
  playedTrackIds: Set<string>;
  automixCurrentTrackId: string | null;
  automixNextTrackId: string | null;
  onLoad: (deck: DjDeckId) => void;
  loadedTrackIds: Record<DjDeckId, string | null>;
}) {
  const [query, setQuery] = useState('');
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const safeIndex = tracks.length ? Math.max(0, Math.min(tracks.length - 1, selectedIndex)) : 0;
  const selectedTrack = tracks[safeIndex] ?? null;
  const editingTrack = editingTrackId ? tracks.find(track => track.id === editingTrackId) ?? null : null;
  const normalized = query.trim().toLocaleLowerCase();
  const playlists = sources.filter(source => source.group === 'playlist');
  const folders = sources.filter(source => source.group === 'folder');
  const filtered = useMemo(() => tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => !normalized || [track.title, track.artist, track.album]
      .some(value => value.toLocaleLowerCase().includes(normalized))), [normalized, tracks]);

  return (
    <section className="dj-pro-library" aria-label="Biblioteca DJ">
      <aside className="dj-library-sidebar" aria-label="Origens da biblioteca DJ">
        <div className="dj-library-sidebar__title">
          <Library aria-hidden="true" />
          <strong>Biblioteca</strong>
        </div>

        <button
          type="button"
          className={selectedLibrarySource === 'all' ? 'is-active' : ''}
          onClick={() => onSelectLibrarySource('all')}
        >
          <Music aria-hidden="true" />
          <span>Todas as faixas</span>
          <small>{tracks.length}</small>
        </button>

        {playlists.length > 0 && (
          <div className="dj-library-sidebar__group">
            <span><ListMusic aria-hidden="true" />Playlists</span>
            {playlists.map(source => (
              <button
                key={source.value}
                type="button"
                className={selectedLibrarySource === source.value ? 'is-active' : ''}
                onClick={() => onSelectLibrarySource(source.value)}
              >
                <span>{source.label}</span>
              </button>
            ))}
          </div>
        )}

        {folders.length > 0 && (
          <div className="dj-library-sidebar__group">
            <span><Folder aria-hidden="true" />Pastas</span>
            {folders.map(source => (
              <button
                key={source.value}
                type="button"
                className={selectedLibrarySource === source.value ? 'is-active' : ''}
                onClick={() => onSelectLibrarySource(source.value)}
              >
                <span>{source.label}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="dj-library-workspace">
        <header className="dj-pro-library__header">
          <label className="dj-pro-library__search-wrap">
            <span className="dj-pro-library__search">
              <Search aria-hidden="true" />
              <input
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder="Buscar na biblioteca..."
                aria-label="Buscar na biblioteca"
              />
            </span>
          </label>

          <label className="dj-pro-library__source">
            <span className="dj-pro-library__control-label">Origem</span>
            <select
              value={selectedLibrarySource}
              onChange={event => onSelectLibrarySource(event.currentTarget.value)}
              aria-label="Selecionar pasta ou playlist"
            >
              <option value="all">Todas as faixas</option>
              {folders.length > 0 && (
                <optgroup label="Pastas">
                  {folders.map(source => (
                    <option key={source.value} value={source.value}>{source.label}</option>
                  ))}
                </optgroup>
              )}
              {playlists.length > 0 && (
                <optgroup label="Playlists">
                  {playlists.map(source => (
                    <option key={source.value} value={source.value}>{source.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>

          <button
            className={shuffle ? 'dj-pro-library__shuffle is-active' : 'dj-pro-library__shuffle'}
            type="button"
            aria-pressed={shuffle}
            onClick={() => onShuffleChange(!shuffle)}
            title="Embaralhar apenas a origem selecionada"
          >
            <Shuffle aria-hidden="true" />
            <span>Aleatório</span>
          </button>

          <div className="dj-library-view-toggle" aria-label="Visualização da biblioteca">
            <button type="button" className="is-active" aria-label="Visualização em lista" aria-pressed="true">
              <List aria-hidden="true" />
            </button>
            <button type="button" aria-label="Visualização em grade" aria-pressed="false" disabled title="Visualização em grade ainda não disponível">
              <LayoutGrid aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="dj-pro-library__columns" aria-hidden="true">
          <span>#</span><span>Título</span><span>Artista</span><span>Álbum</span><span>BPM</span><span>Duração</span>
        </div>

        <div className="dj-pro-library__list" role="listbox" aria-label="Faixas">
          {filtered.map(({ track, index }) => {
            const loadedA = loadedTrackIds.a === track.id;
            const loadedB = loadedTrackIds.b === track.id;
            const automixCurrent = automixCurrentTrackId === track.id;
            const automixNext = automixNextTrackId === track.id && !automixCurrent;
            return (
              <button
                key={track.id}
                type="button"
                role="option"
                aria-selected={index === safeIndex}
                className={[
                  index === safeIndex ? 'is-selected' : '',
                  playedTrackIds.has(track.id) ? 'is-played' : '',
                  automixCurrent ? 'is-automix-current' : '',
                  automixNext ? 'is-automix-next' : ''
                ].filter(Boolean).join(' ')}
                onClick={() => onSelect(index)}
              >
                <span>{index + 1}</span>
                <span className="dj-library-track-title">
                  <span className="dj-library-track-art"><Artwork track={track} /></span>
                  <span className="dj-library-track-copy">
                    <strong>{track.title}</strong>
                    <span className="dj-library-track-badges">
                      {loadedA ? <small className="dj-library-deck-badge" data-deck="a">A</small> : null}
                      {loadedB ? <small className="dj-library-deck-badge" data-deck="b">B</small> : null}
                      {automixCurrent ? <small className="dj-library-status-badge">AGORA</small> : null}
                      {automixNext ? <small className="dj-library-status-badge">PRÓXIMA</small> : null}
                    </span>
                  </span>
                </span>
                <span>{track.artist || 'Artista desconhecido'}</span>
                <span>{track.album || '—'}</span>
                <span>
                  {track.rhythm?.bpm ? track.rhythm.bpm.toFixed(1) : '—'}
                  {track.rhythm?.manualOverride ? <small className="dj-grid-manual-badge">M</small> : null}
                </span>
                <span>{formatTime(track.duration ?? 0)}</span>
              </button>
            );
          })}
          {!filtered.length && <div className="dj-pro-library__empty">Nenhuma faixa encontrada.</div>}
        </div>

        <footer className="dj-pro-library__footer">
          <span>{filtered.length} faixas</span>
          <div className="dj-pro-library__loads">
            <button
              type="button"
              disabled={!selectedTrack || loadedTrackIds.a === selectedTrack.id}
              onClick={() => onLoad('a')}
            >
              <Upload aria-hidden="true" />LOAD A
            </button>
            <button
              type="button"
              disabled={!selectedTrack || loadedTrackIds.b === selectedTrack.id}
              onClick={() => onLoad('b')}
            >
              <Upload aria-hidden="true" />LOAD B
            </button>
            <button type="button" disabled={!selectedTrack} onClick={() => setEditingTrackId(selectedTrack?.id ?? null)}>
              <SlidersHorizontal aria-hidden="true" />Ajustar grid
            </button>
          </div>
        </footer>

        {editingTrack && (
          <RhythmGridEditor
            key={editingTrack.id}
            track={editingTrack}
            onClose={() => setEditingTrackId(null)}
          />
        )}
      </div>
    </section>
  );
}

function midiStatusText(status: WebMidiController['status']) {
  switch (status) {
    case 'connecting': return 'Conectando…';
    case 'connected': return 'Conectado';
    case 'denied': return 'Permissão negada';
    case 'error': return 'Falha ao conectar';
    default: return 'Desconectado';
  }
}

function DjMidiPanel({
  midi,
  onDisconnect,
  onSelectOutput
}: {
  midi: WebMidiController;
  onDisconnect: () => void;
  onSelectOutput: (id: string | null) => boolean;
}) {
  return (
    <section className="dj-pro-midi" aria-label="Controlador MIDI">
      <div className="dj-pro-midi__heading">
        <div><Cable aria-hidden="true" /><strong>Controlador MIDI</strong></div>
        <button
          type="button"
          className="dj-pro-midi__settings"
          aria-pressed={midi.diagnosticsEnabled}
          aria-label="Diagnóstico MIDI"
          title={midi.diagnosticsEnabled ? 'Ocultar diagnóstico MIDI' : 'Mostrar diagnóstico MIDI'}
          onClick={() => midi.setDiagnosticsEnabled(!midi.diagnosticsEnabled)}
        >
          <Settings aria-hidden="true" />
        </button>
      </div>
      <div className="dj-pro-midi__status">
        <span data-connected={midi.status === 'connected' ? 'true' : 'false'} />
        {midi.supported ? midiStatusText(midi.status) : 'Web MIDI indisponível'}
      </div>

      {midi.status !== 'connected' ? (
        <button type="button" disabled={!midi.supported || midi.status === 'connecting'} onClick={() => void midi.connect()}>
          <Cable aria-hidden="true" />
          {midi.status === 'connecting' ? 'Conectando…' : 'Conectar'}
        </button>
      ) : (
        <>
          <label>
            <span>Entrada</span>
            <select value={midi.selectedInputId ?? ''} onChange={event => midi.selectInput(event.currentTarget.value || null)}>
              <option value="">Nenhuma</option>
              {midi.inputs.map(port => <option key={port.id} value={port.id}>{port.name}</option>)}
            </select>
          </label>
          <label>
            <span>Saída <small>(opcional)</small></span>
            <select value={midi.selectedOutputId ?? ''} onChange={event => onSelectOutput(event.currentTarget.value || null)}>
              <option value="">Nenhuma</option>
              {midi.outputs.map(port => <option key={port.id} value={port.id}>{port.name}</option>)}
            </select>
          </label>
          {midi.diagnosticsEnabled && (
            <div className="dj-pro-midi__diagnostics" aria-label="Diagnóstico MIDI ativo">
              <div className="dj-pro-midi__diagnostics-heading">
                <strong>Diagnóstico local</strong>
                <span>Não persistido</span>
              </div>
              {midi.lastMessage ? (
                <dl>
                  <div><dt>Origem</dt><dd>{midi.inputs.find(port => port.id === midi.lastMessage?.sourceId)?.name ?? midi.lastMessage.sourceId}</dd></div>
                  <div><dt>Status</dt><dd>{'0x' + midi.lastMessage.status.toString(16).padStart(2, '0').toUpperCase()}</dd></div>
                  <div><dt>Canal</dt><dd>{midi.lastMessage.channel + 1}</dd></div>
                  <div><dt>Data 1</dt><dd>{midi.lastMessage.data1} · {'0x' + midi.lastMessage.data1.toString(16).padStart(2, '0').toUpperCase()}</dd></div>
                  <div><dt>Data 2</dt><dd>{midi.lastMessage.data2} · {'0x' + midi.lastMessage.data2.toString(16).padStart(2, '0').toUpperCase()}</dd></div>
                </dl>
              ) : (
                <span className="dj-pro-midi__diagnostics-empty">Mova um controle para capturar o último evento.</span>
              )}
            </div>
          )}
          <button type="button" onClick={onDisconnect}>Desconectar</button>
        </>
      )}
    </section>
  );
}

function DjMixer({
  mixer,
  meterLevels,
  onChannelVolume,
  onEq,
  onFxEnabled,
  onFxWet,
  onEchoFeedback,
  onEchoDelay,
  onCrossfader
}: {
  mixer: DualDeckMixerState;
  meterLevels: Record<DjDeckId, number>;
  onChannelVolume: (deck: DjDeckId, value: number) => void;
  onEq: (deck: DjDeckId, control: DjEqControl, value: number) => void;
  onFxEnabled: (deck: DjDeckId, kind: DjFxKind, enabled: boolean) => void;
  onFxWet: (deck: DjDeckId, kind: DjFxKind, wet: number) => void;
  onEchoFeedback: (deck: DjDeckId, feedback: number) => void;
  onEchoDelay: (deck: DjDeckId, delaySeconds: number) => void;
  onCrossfader: (value: number) => void;
}) {
  const channelMeter = (deck: DjDeckId, value: number) => (
    <span className="dj-channel-meter" data-deck={deck} aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} data-on={index < Math.round(value * 12) ? 'true' : 'false'} />
      ))}
    </span>
  );

  const eqControls: Array<{ control: DjEqControl; label: string }> = [
    { control: 'high', label: 'AGUDOS' },
    { control: 'mid', label: 'MÉDIOS' },
    { control: 'low', label: 'GRAVES' },
    { control: 'filter', label: 'FILTRO' }
  ];

  const renderEq = (deck: DjDeckId) => (
    <div className="dj-eq-strip" aria-label={'EQ Channel ' + deck.toUpperCase()}>
      {eqControls.map(({ control, label }) => {
        const value = mixer.eq[deck][control];
        const valueText = control === 'filter'
          ? (Math.round(value * 100) + '%')
          : ((value * DJ_EQ_GAIN_DB).toFixed(1) + ' dB');
        return (
          <label className="dj-eq-control" key={control}>
            <span
              className="dj-eq-knob"
              style={{ '--dj-eq-angle': `${value * 135}deg` } as CSSProperties}
              title={label + ' · ' + valueText + ' · duplo clique para zerar'}
            >
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={value}
                aria-label={label + ' Channel ' + deck.toUpperCase()}
                aria-valuetext={valueText}
                onChange={event => onEq(deck, control, Number(event.currentTarget.value))}
                onDoubleClick={() => onEq(deck, control, 0)}
              />
            </span>
            <small>{label}</small>
            <output className="dj-eq-value" aria-hidden="true">{valueText}</output>
          </label>
        );
      })}
    </div>
  );

  const renderChannel = (deck: DjDeckId) => {
    const fx = mixer.fx[deck];
    const channel = deck.toUpperCase();
    return (
      <div className="dj-pro-mixer__channel" data-deck={deck}>
        <span className="dj-mixer-channel-title">{channel}</span>
        {renderEq(deck)}

        <div className="dj-mixer-fx" aria-label={'FX Channel ' + channel}>
          <div className="dj-mixer-fx__row" data-enabled={fx.echo.enabled ? 'true' : 'false'}>
            <button
              type="button"
              className={fx.echo.enabled ? 'is-active' : ''}
              aria-pressed={fx.echo.enabled}
              aria-label={'Echo Channel ' + channel}
              onClick={() => onFxEnabled(deck, 'echo', !fx.echo.enabled)}
            >
              ECHO
            </button>
            <label title={'Echo mix ' + Math.round(fx.echo.wet * 100) + '%'}>
              <span>MIX</span>
              <input
                aria-label={'Echo Wet Channel ' + channel}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={fx.echo.wet}
                onChange={event => onFxWet(deck, 'echo', Number(event.currentTarget.value))}
              />
            </label>
            <label title={'Feedback ' + Math.round(fx.echo.feedback * 100) + '%'}>
              <span>FDBK</span>
              <input
                aria-label={'Echo Feedback Channel ' + channel}
                type="range"
                min="0"
                max="0.82"
                step="0.01"
                value={fx.echo.feedback}
                onChange={event => onEchoFeedback(deck, Number(event.currentTarget.value))}
              />
            </label>
            <label title={'Delay ' + Math.round(fx.echo.delaySeconds * 1000) + ' ms'}>
              <span>TIME</span>
              <input
                aria-label={'Echo Delay Channel ' + channel}
                type="range"
                min="0.06"
                max="1.5"
                step="0.01"
                value={fx.echo.delaySeconds}
                onChange={event => onEchoDelay(deck, Number(event.currentTarget.value))}
              />
            </label>
          </div>

          <div className="dj-mixer-fx__row" data-enabled={fx.reverb.enabled ? 'true' : 'false'}>
            <button
              type="button"
              className={fx.reverb.enabled ? 'is-active' : ''}
              aria-pressed={fx.reverb.enabled}
              aria-label={'Reverb Channel ' + channel}
              onClick={() => onFxEnabled(deck, 'reverb', !fx.reverb.enabled)}
            >
              REVERB
            </button>
            <label className="dj-mixer-fx__wide" title={'Reverb mix ' + Math.round(fx.reverb.wet * 100) + '%'}>
              <span>MIX</span>
              <input
                aria-label={'Reverb Wet Channel ' + channel}
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={fx.reverb.wet}
                onChange={event => onFxWet(deck, 'reverb', Number(event.currentTarget.value))}
              />
            </label>
          </div>
        </div>

        <label className="dj-mixer-channel-volume">
          <Gauge aria-hidden="true" />
          <span className="sr-only">{'Volume Channel ' + channel}</span>
          <input
            aria-label={'Volume Channel ' + channel}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={mixer.channelVolumes[deck]}
            onChange={event => onChannelVolume(deck, Number(event.currentTarget.value))}
          />
          <strong>{Math.round(mixer.channelVolumes[deck] * 100)}%</strong>
        </label>
      </div>
    );
  };

  return (
    <section className="dj-pro-mixer dj-pro-mixer--console" aria-label="Mixer">
      <div className="dj-pro-mixer__title">
        <SlidersHorizontal aria-hidden="true" />
        <strong>Mixer</strong>
      </div>

      <div className="dj-mixer-bank">
        {renderChannel('a')}
        <div className="dj-mixer-meter-pair" aria-label="Medidores de nível">
          {channelMeter('a', meterLevels.a)}
          {channelMeter('b', meterLevels.b)}
        </div>
        {renderChannel('b')}
      </div>

      <label
        className="dj-pro-mixer__crossfader"
        data-side={Math.abs(mixer.crossfader) < 0.005 ? 'center' : mixer.crossfader < 0 ? 'a' : 'b'}
      >
        <span>CROSSFADER</span>
        <div>
          <small>A</small>
          <input
            aria-label="Crossfader"
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={mixer.crossfader}
            onChange={event => onCrossfader(Number(event.currentTarget.value))}
          />
          <small>B</small>
        </div>
        <strong>
          {mixer.crossfader === 0
            ? 'Centro'
            : mixer.crossfader < 0
              ? 'A ' + Math.round(Math.abs(mixer.crossfader) * 100) + '%'
              : 'B ' + Math.round(mixer.crossfader * 100) + '%'}
        </strong>
      </label>
    </section>
  );
}

export function DjModeScreen({
  decks,
  mixer,
  libraryTracks,
  librarySources,
  selectedLibrarySource,
  onSelectLibrarySource,
  selectedLibraryIndex,
  onSelectLibraryIndex,
  automixShuffle,
  onAutomixShuffleChange,
  playedTrackIds,
  automixCurrentTrackId,
  automixNextTrackId,
  onLoadSelectedTrack,
  midi,
  onDisconnectMidi,
  onSelectMidiOutput,
  onChannelVolume,
  onEq,
  onFxEnabled,
  onFxWet,
  onEchoFeedback,
  onEchoDelay,
  onCrossfader,
  onTogglePlay,
  onCue,
  onSync,
  onTempo,
  onNudge,
  onSeek,
  mixMode,
  onMixModeChange,
  onExit
}: DjModeScreenProps) {
  const [workspacePanel, setWorkspacePanel] = useState<'library' | 'mixer'>('library');

  return (
    <section className="dj-mode dj-mode--prototype-three" aria-label="Modo DJ">
      <header className="dj-mode__header">
        <div className="dj-mode__brand">
          <span className="dj-mode__brand-icon" aria-hidden="true"><Disc3 /></span>
          <strong>Home Music</strong>
        </div>

        <div className="dj-mode__nav" aria-label="Área atual">
          <span className="is-active">DJ</span>
          <span>Biblioteca</span>
          <span>Playlists</span>
          <span>Explorar</span>
          <span>Configurações</span>
        </div>

        <div className="dj-mode__header-actions">
          <span className="dj-mode__status">
            <strong>Modo DJ</strong>
            <small>Dual-deck + Mixer</small>
          </span>

          <details className="dj-shortcuts">
            <summary><Keyboard aria-hidden="true" /><span>Atalhos</span></summary>
            <div className="dj-shortcuts__panel">
              <div><strong>Decks</strong><span><kbd>1</kbd>/<kbd>2</kbd> Play · <kbd>Q</kbd>/<kbd>W</kbd> Cue · <kbd>A</kbd>/<kbd>S</kbd> Sync</span></div>
              <div><strong>Biblioteca</strong><span><kbd>←</kbd>/<kbd>→</kbd> Seleção · <kbd>Z</kbd>/<kbd>X</kbd> Load A/B</span></div>
              <div><strong>Nudge</strong><span><kbd>R</kbd>/<kbd>T</kbd> Deck A · <kbd>Y</kbd>/<kbd>U</kbd> Deck B</span></div>
              <div><strong>Mixer</strong><span><kbd>F</kbd>/<kbd>G</kbd> Canal A · <kbd>H</kbd>/<kbd>J</kbd> Canal B · <kbd>,</kbd>/<kbd>.</kbd> Crossfader</span></div>
            </div>
          </details>

          <div className="dj-mode__mode-switch" aria-label="Modo de mixagem">
            <button
              type="button"
              className={mixMode === 'manual' ? 'is-active' : ''}
              aria-pressed={mixMode === 'manual'}
              onClick={() => onMixModeChange('manual')}
            >
              Manual
            </button>
            <button
              type="button"
              className={mixMode === 'automix' ? 'is-active' : ''}
              aria-pressed={mixMode === 'automix'}
              onClick={() => onMixModeChange('automix')}
            >
              AutoMix
            </button>
          </div>

          <button className="dj-mode__exit" type="button" onClick={onExit}>
            <ArrowLeft aria-hidden="true" /><span>Sair do modo DJ</span>
          </button>
        </div>
      </header>

      <main className="dj-pro-layout" data-workspace-panel={workspacePanel}>
        <DeckPanel deck="a" state={decks.a} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} onTempo={onTempo} onNudge={onNudge} onSeek={onSeek} />

        <div className="dj-workspace-switch" role="group" aria-label="Painel do workspace DJ">
          <button
            type="button"
            className={workspacePanel === 'library' ? 'is-active' : ''}
            aria-pressed={workspacePanel === 'library'}
            onClick={() => setWorkspacePanel('library')}
          >
            Biblioteca
          </button>
          <button
            type="button"
            className={workspacePanel === 'mixer' ? 'is-active' : ''}
            aria-pressed={workspacePanel === 'mixer'}
            onClick={() => setWorkspacePanel('mixer')}
          >
            Mixer
          </button>
        </div>

        <DjMixer
          mixer={mixer}
          meterLevels={{ a: decks.a.meterLevel, b: decks.b.meterLevel }}
          onChannelVolume={onChannelVolume}
          onEq={onEq}
          onFxEnabled={onFxEnabled}
          onFxWet={onFxWet}
          onEchoFeedback={onEchoFeedback}
          onEchoDelay={onEchoDelay}
          onCrossfader={onCrossfader}
        />

        <DeckPanel deck="b" state={decks.b} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} onTempo={onTempo} onNudge={onNudge} onSeek={onSeek} />

        <DjLibrary
          tracks={libraryTracks}
          sources={librarySources}
          selectedLibrarySource={selectedLibrarySource}
          onSelectLibrarySource={onSelectLibrarySource}
          selectedIndex={selectedLibraryIndex}
          onSelect={onSelectLibraryIndex}
          shuffle={automixShuffle}
          onShuffleChange={onAutomixShuffleChange}
          playedTrackIds={playedTrackIds}
          automixCurrentTrackId={automixCurrentTrackId}
          automixNextTrackId={automixNextTrackId}
          onLoad={onLoadSelectedTrack}
          loadedTrackIds={{
            a: decks.a.snapshot?.trackId ?? null,
            b: decks.b.snapshot?.trackId ?? null
          }}
        />

        <details className="dj-midi-drawer">
          <summary>
            <span>Controlador MIDI</span>
            <small>{midi.supported ? midiStatusText(midi.status) : 'Web MIDI indisponível'}</small>
          </summary>
          <DjMidiPanel midi={midi} onDisconnect={onDisconnectMidi} onSelectOutput={onSelectMidiOutput} />
        </details>
      </main>
    </section>
  );
}
