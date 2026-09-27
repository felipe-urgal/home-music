import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Track, TrackRhythmOverride, TrackWaveform } from '@home-music/shared';
import {
  ArrowLeft,
  Cable,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Gauge,
  Keyboard,
  MoreVertical,
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
import { buildDjWaveformMarkers } from '../dj-waveform-grid';
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
  onLoadSelectedTrack: (deck: DjDeckId) => void;
  midi: WebMidiController;
  onDisconnectMidi: () => void;
  onSelectMidiOutput: (id: string | null) => boolean;
  onChannelVolume: (deck: DjDeckId, value: number) => void;
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
  progress
}: {
  deck: DjDeckId;
  track: Track;
  progress: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waveform, setWaveform] = useState<TrackWaveform | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'ready' | 'unavailable'>('loading');

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

  return (
    <div className="dj-waveform" data-status={status} aria-label="Waveform real da faixa">
      <canvas ref={canvasRef} className="dj-waveform__canvas" aria-hidden="true" />
      <span className="dj-waveform__remaining" style={{ left: `${progress}%` }} aria-hidden="true" />
      <span className="dj-waveform__playhead" style={{ left: `${progress}%` }} aria-hidden="true" />
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

  useEffect(() => {
    setLoopIn(null);
    setLoopOut(null);
    setLoopActive(false);
    setLoopBeats(4);
  }, [snapshot?.trackId]);

  useEffect(() => {
    if (!loopActive || loopIn == null || loopOut == null || !snapshot?.trackId) return;
    if (snapshot.currentTimeSeconds >= loopOut) onSeek(deck, loopIn);
  }, [deck, loopActive, loopIn, loopOut, onSeek, snapshot?.currentTimeSeconds, snapshot?.trackId]);

  const changeLoopBeats = (direction: -1 | 1) => {
    const sizes = [1, 2, 4, 8, 16];
    const current = sizes.indexOf(loopBeats);
    const next = sizes[Math.max(0, Math.min(sizes.length - 1, current + direction))] ?? 4;
    setLoopBeats(next);
    if (loopIn != null && bpm) {
      setLoopOut(loopIn + ((60 / bpm) * next));
      setLoopActive(true);
    }
  };

  const setLoopStart = () => {
    if (!snapshot?.trackId) return;
    const startSeconds = snapshot.currentTimeSeconds;
    setLoopIn(startSeconds);
    if (bpm) {
      setLoopOut(startSeconds + ((60 / bpm) * loopBeats));
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
          <span className="dj-deck-letter" aria-hidden="true">{deck.toUpperCase()}</span>
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
              <div className="dj-pro-deck__track-tags">
                <small>{bpm ? bpm.toFixed(1) + ' BPM' : 'BPM —'}</small>
                <small>{formatTime(snapshot?.durationSeconds ?? state.track?.duration ?? 0)}</small>
                {state.track?.rhythm?.manualOverride ? <small>GRID M</small> : null}
              </div>
            </div>
          </div>

          <DjWaveform deck={deck} track={state.track!} progress={progress} />

          <div className="dj-pro-deck__timeline">
            <span>{formatTime(snapshot?.currentTimeSeconds ?? 0)}</span>
            <span>{formatTime(snapshot?.durationSeconds ?? state.track?.duration ?? 0)}</span>
          </div>

          <button
            type="button"
            className="dj-pro-deck__progress"
            aria-label={'Buscar posição no ' + label}
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
              onSeek(deck, ratio * (snapshot?.durationSeconds ?? state.track?.duration ?? 0));
            }}
          >
            <span style={{ width: progress + '%' }} />
          </button>

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
                  onClick={() => loopOut != null && setLoopActive(value => !value)}
                  aria-pressed={loopActive}
                  title="Ativar/desativar loop"
                >
                  {loopBeats}
                </button>
                <button type="button" aria-label={'Aumentar loop ' + label} onClick={() => changeLoopBeats(1)}><ChevronRight aria-hidden="true" /></button>
              </div>
            </div>
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

      <DjWaveform deck="a" track={previewTrack} progress={0} />

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
  onLoad: (deck: DjDeckId) => void;
  loadedTrackIds: Record<DjDeckId, string | null>;
}) {
  const [query, setQuery] = useState('');
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const safeIndex = tracks.length ? Math.max(0, Math.min(tracks.length - 1, selectedIndex)) : 0;
  const selectedTrack = tracks[safeIndex] ?? null;
  const editingTrack = editingTrackId ? tracks.find(track => track.id === editingTrackId) ?? null : null;
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => !normalized || [track.title, track.artist, track.album]
      .some(value => value.toLocaleLowerCase().includes(normalized)))
    .slice(0, 40), [normalized, tracks]);

  return (
    <section className="dj-pro-library" aria-label="Biblioteca DJ">
      <header className="dj-pro-library__header">
        <div className="dj-pro-library__identity">
          <span className="dj-pro-library__control-label">Biblioteca</span>
          <div><strong>Biblioteca</strong><span>{tracks.length} faixas</span></div>
        </div>

        <label className="dj-pro-library__source">
          <span className="dj-pro-library__control-label">Origem</span>
          <select
            value={selectedLibrarySource}
            onChange={event => onSelectLibrarySource(event.currentTarget.value)}
            aria-label="Selecionar pasta ou playlist"
          >
            <option value="all">Todas as faixas</option>
            <optgroup label="Pastas">
              {sources.filter(source => source.group === 'folder').map(source => (
                <option key={source.value} value={source.value}>{source.label}</option>
              ))}
            </optgroup>
            <optgroup label="Playlists">
              {sources.filter(source => source.group === 'playlist').map(source => (
                <option key={source.value} value={source.value}>{source.label}</option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="dj-pro-library__search-wrap">
          <span className="dj-pro-library__control-label">Buscar</span>
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
      </header>

      <div className="dj-pro-library__columns" aria-hidden="true">
        <span>#</span><span>Título</span><span>Artista</span><span>BPM</span><span>Duração</span>
      </div>

      <div className="dj-pro-library__list" role="listbox" aria-label="Faixas">
        {filtered.map(({ track, index }) => (
          <button
            key={track.id}
            type="button"
            role="option"
            aria-selected={index === safeIndex}
            className={[
              index === safeIndex ? 'is-selected' : '',
              playedTrackIds.has(track.id) ? 'is-played' : ''
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect(index)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{track.title}</strong>
            <span>{track.artist || 'Artista desconhecido'}</span>
            <span>
              {track.rhythm?.bpm ? track.rhythm.bpm.toFixed(1) : '—'}
              {track.rhythm?.manualOverride ? <small className="dj-grid-manual-badge">M</small> : null}
            </span>
            <span>{formatTime(track.duration ?? 0)}</span>
          </button>
        ))}
        {!filtered.length && <div className="dj-pro-library__empty">Nenhuma faixa encontrada.</div>}
      </div>

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

      {editingTrack && (
        <RhythmGridEditor
          key={editingTrack.id}
          track={editingTrack}
          onClose={() => setEditingTrackId(null)}
        />
      )}
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
        <span className="dj-pro-midi__settings" title="Configurações MIDI"><Settings aria-hidden="true" /></span>
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
            <span>Saída</span>
            <select value={midi.selectedOutputId ?? ''} onChange={event => onSelectOutput(event.currentTarget.value || null)}>
              <option value="">Nenhuma</option>
              {midi.outputs.map(port => <option key={port.id} value={port.id}>{port.name}</option>)}
            </select>
          </label>
          <button type="button" onClick={onDisconnect}>Desconectar</button>
        </>
      )}
    </section>
  );
}

function DjMixer({
  mixer,
  onChannelVolume,
  onCrossfader
}: {
  mixer: DualDeckMixerState;
  onChannelVolume: (deck: DjDeckId, value: number) => void;
  onCrossfader: (value: number) => void;
}) {
  const channelMeter = (value: number) => (
    <span className="dj-channel-meter" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} data-on={index < Math.round(value * 12) ? 'true' : 'false'} />
      ))}
    </span>
  );

  return (
    <section className="dj-pro-mixer dj-pro-mixer--console" aria-label="Mixer">
      <div className="dj-pro-mixer__title"><SlidersHorizontal aria-hidden="true" /><strong>Mixer</strong></div>
      <label className="dj-pro-mixer__channel" data-deck="a">
        <span className="dj-mixer-channel-title">Channel A</span>
        <div className="dj-eq-strip" aria-label="EQ Channel A aguardando validação da interface de áudio">
          {['LOW', 'MID', 'HIGH', 'FILTER'].map((label, index) => (
            <span className="dj-eq-control" key={label}>
              <i className="dj-eq-knob" style={{ '--knob-angle': (index === 3 ? '18deg' : '0deg') } as React.CSSProperties} />
              <small>{label}</small>
            </span>
          ))}
        </div>
        <div className="dj-mixer-channel-row">
          <Gauge aria-hidden="true" />
          <input type="range" min="0" max="1" step="0.01" value={mixer.channelVolumes.a} onChange={event => onChannelVolume('a', Number(event.currentTarget.value))} />
        </div>
        <strong>{Math.round(mixer.channelVolumes.a * 100)}%</strong>
        {channelMeter(mixer.channelVolumes.a)}
      </label>
      <label className="dj-pro-mixer__crossfader">
        <span>Crossfader</span>
        <div><small>A</small><input type="range" min="-1" max="1" step="0.01" value={mixer.crossfader} onChange={event => onCrossfader(Number(event.currentTarget.value))} /><small>B</small></div>
        <strong>{mixer.crossfader === 0 ? 'Centro' : mixer.crossfader < 0 ? 'A ' + Math.round(Math.abs(mixer.crossfader) * 100) + '%' : 'B ' + Math.round(mixer.crossfader * 100) + '%'}</strong>
      </label>
      <label className="dj-pro-mixer__channel" data-deck="b">
        <span className="dj-mixer-channel-title">Channel B</span>
        <div className="dj-eq-strip" aria-label="EQ Channel B aguardando validação da interface de áudio">
          {['LOW', 'MID', 'HIGH', 'FILTER'].map((label, index) => (
            <span className="dj-eq-control" key={label}>
              <i className="dj-eq-knob" style={{ '--knob-angle': (index === 3 ? '-18deg' : '0deg') } as React.CSSProperties} />
              <small>{label}</small>
            </span>
          ))}
        </div>
        <div className="dj-mixer-channel-row">
          <Gauge aria-hidden="true" />
          <input type="range" min="0" max="1" step="0.01" value={mixer.channelVolumes.b} onChange={event => onChannelVolume('b', Number(event.currentTarget.value))} />
        </div>
        <strong>{Math.round(mixer.channelVolumes.b * 100)}%</strong>
        {channelMeter(mixer.channelVolumes.b)}
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
  onLoadSelectedTrack,
  midi,
  onDisconnectMidi,
  onSelectMidiOutput,
  onChannelVolume,
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
  return (
    <section className="dj-mode dj-mode--prototype-three" aria-label="Modo DJ">
      <header className="dj-mode__header">
        <div className="dj-mode__brand">
          <span className="dj-mode__brand-icon" aria-hidden="true"><Disc3 /></span>
          <div><strong>Modo DJ</strong><small>Dual-deck · Misture, crie e mantenha o flow</small></div>
        </div>
        <div className="dj-mode__header-actions">
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

      <main className="dj-pro-layout">
        <DeckPanel deck="a" state={decks.a} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} onTempo={onTempo} onNudge={onNudge} onSeek={onSeek} />
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
          onLoad={onLoadSelectedTrack}
          loadedTrackIds={{
            a: decks.a.snapshot?.trackId ?? null,
            b: decks.b.snapshot?.trackId ?? null
          }}
        />
        <DeckPanel deck="b" state={decks.b} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} onTempo={onTempo} onNudge={onNudge} onSeek={onSeek} />
        <DjMixer mixer={mixer} onChannelVolume={onChannelVolume} onCrossfader={onCrossfader} />
        <DjMidiPanel midi={midi} onDisconnect={onDisconnectMidi} onSelectOutput={onSelectMidiOutput} />
      </main>
    </section>
  );
}
