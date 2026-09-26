import { useMemo, useState } from 'react';
import type { Track } from '@home-music/shared';
import {
  ArrowLeft,
  Cable,
  Disc3,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Upload,
  Zap,
} from 'lucide-react';
import type { DjDeckId } from '../dj-controller-contract';
import type { DualDeckAudioSnapshot } from '../dual-deck-audio';
import type { DualDeckMixerState } from '../dual-deck-mixer';
import type { WebMidiController } from '../useWebMidiController';
import { Artwork } from './Artwork';

export type DjDeckPanelState = {
  snapshot: DualDeckAudioSnapshot | null;
  track: Track | null;
  cuePointSeconds: number | null;
  syncActive: boolean;
  channelVolume: number;
};

type DjModeScreenProps = {
  decks: Record<DjDeckId, DjDeckPanelState>;
  mixer: DualDeckMixerState;
  libraryTracks: Track[];
  libraryFolders: Array<{ path: string; label: string }>;
  selectedFolderPath: string;
  onSelectFolderPath: (path: string) => void;
  selectedLibraryIndex: number;
  onSelectLibraryIndex: (index: number) => void;
  onLoadSelectedTrack: (deck: DjDeckId) => void;
  midi: WebMidiController;
  onDisconnectMidi: () => void;
  onSelectMidiOutput: (id: string | null) => boolean;
  onChannelVolume: (deck: DjDeckId, value: number) => void;
  onCrossfader: (value: number) => void;
  onTogglePlay: (deck: DjDeckId) => void;
  onCue: (deck: DjDeckId) => void;
  onSync: (deck: DjDeckId) => void;
  mixMode: 'manual' | 'automix';
  onMixModeChange: (mode: 'manual' | 'automix') => void;
  onExit: () => void;
};

const WAVEFORM = [
  0.32, 0.48, 0.68, 0.84, 0.57, 0.74, 0.96, 0.71, 0.52, 0.88, 0.64, 0.43,
  0.76, 0.92, 0.61, 0.38, 0.73, 0.87, 0.56, 0.42, 0.67, 0.81, 0.58, 0.46,
  0.62, 0.49, 0.36, 0.28, 0.22, 0.18, 0.14, 0.11
];

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function pitchPercent(playbackRate: number) {
  return (playbackRate - 1) * 100;
}

function DjWaveform({ progress }: { progress: number }) {
  return (
    <div className="dj-waveform" aria-hidden="true">
      <div className="dj-waveform__bars">
        {WAVEFORM.map((height, index) => (
          <span key={index} style={{ height: `${Math.round(height * 100)}%` }} />
        ))}
      </div>
      <span className="dj-waveform__playhead" style={{ left: `${progress}%` }} />
    </div>
  );
}

function DeckPanel({
  deck,
  state,
  onTogglePlay,
  onCue,
  onSync
}: {
  deck: DjDeckId;
  state: DjDeckPanelState;
  onTogglePlay: (deck: DjDeckId) => void;
  onCue: (deck: DjDeckId) => void;
  onSync: (deck: DjDeckId) => void;
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

  return (
    <article className="dj-pro-deck" aria-label={label} data-deck={deck} data-playing={playing ? 'true' : 'false'}>
      <div className="dj-pro-deck__heading">
        <strong>{label}</strong>
        <span>{side}</span>
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
            <div>
              <strong>{state.track?.title}</strong>
              <span>{state.track?.artist || 'Artista desconhecido'}</span>
            </div>
          </div>

          <DjWaveform progress={progress} />

          <div className="dj-pro-deck__timeline">
            <span>{formatTime(snapshot?.currentTimeSeconds ?? 0)}</span>
            <span>{formatTime(snapshot?.durationSeconds ?? state.track?.duration ?? 0)}</span>
          </div>

          <div className="dj-pro-deck__progress" aria-label="Progresso da faixa">
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="dj-pro-deck__metrics">
            <div><span>BPM</span><strong>{bpm ? bpm.toFixed(1) : '—'}</strong></div>
            <div><span>Pitch</span><strong>{pitchPercent(rate) >= 0 ? '+' : ''}{pitchPercent(rate).toFixed(2)}%</strong></div>
            <div><span>Rate</span><strong>{rate.toFixed(3)}×</strong></div>
            <div><span>Canal</span><strong>{Math.round(state.channelVolume * 100)}%</strong></div>
          </div>

          <div className="dj-pro-deck__controls">
            <button
              type="button"
              className={playing ? 'is-primary' : ''}
              onClick={() => onTogglePlay(deck)}
              aria-label={playing ? `Pausar ${label}` : `Reproduzir ${label}`}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button type="button" onClick={() => onCue(deck)}>
              <RotateCcw aria-hidden="true" /><span>CUE</span>
            </button>
            <button type="button" className={state.syncActive ? 'is-active' : ''} onClick={() => onSync(deck)}>
              <Zap aria-hidden="true" /><span>SYNC</span>
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function DjLibrary({
  tracks,
  folders,
  selectedFolderPath,
  onSelectFolderPath,
  selectedIndex,
  onSelect,
  onLoad
}: {
  tracks: Track[];
  folders: Array<{ path: string; label: string }>;
  selectedFolderPath: string;
  onSelectFolderPath: (path: string) => void;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onLoad: (deck: DjDeckId) => void;
}) {
  const [query, setQuery] = useState('');
  const safeIndex = tracks.length ? Math.max(0, Math.min(tracks.length - 1, selectedIndex)) : 0;
  const selectedTrack = tracks[safeIndex] ?? null;
  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(() => tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => !normalized || [track.title, track.artist, track.album]
      .some(value => value.toLocaleLowerCase().includes(normalized)))
    .slice(0, 40), [normalized, tracks]);

  return (
    <section className="dj-pro-library" aria-label="Biblioteca DJ">
      <header className="dj-pro-library__header">
        <div>
          <strong>Biblioteca</strong>
          <span>{tracks.length} faixas</span>
        </div>
        <div className="dj-pro-library__tools">
          <label className="dj-pro-library__folder">
            <span>Pasta</span>
            <select
              value={selectedFolderPath}
              onChange={event => onSelectFolderPath(event.currentTarget.value)}
              aria-label="Selecionar pasta da biblioteca"
            >
              {folders.map(folder => (
                <option key={folder.path || '__root__'} value={folder.path}>{folder.label}</option>
              ))}
            </select>
          </label>
          <label className="dj-pro-library__search">
            <Search aria-hidden="true" />
            <input
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
              placeholder="Buscar na biblioteca..."
              aria-label="Buscar na biblioteca"
            />
          </label>
        </div>
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
            className={index === safeIndex ? 'is-selected' : ''}
            onClick={() => onSelect(index)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{track.title}</strong>
            <span>{track.artist || 'Artista desconhecido'}</span>
            <span>{track.rhythm?.bpm ? track.rhythm.bpm.toFixed(1) : '—'}</span>
            <span>{formatTime(track.duration ?? 0)}</span>
          </button>
        ))}
        {!filtered.length && <div className="dj-pro-library__empty">Nenhuma faixa encontrada.</div>}
      </div>

      <div className="dj-pro-library__loads">
        <button type="button" disabled={!selectedTrack} onClick={() => onLoad('a')}><Upload aria-hidden="true" />LOAD A</button>
        <button type="button" disabled={!selectedTrack} onClick={() => onLoad('b')}><Upload aria-hidden="true" />LOAD B</button>
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
        <Cable aria-hidden="true" />
        <strong>Controlador MIDI</strong>
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
  return (
    <section className="dj-pro-mixer" aria-label="Mixer">
      <div className="dj-pro-mixer__title"><SlidersHorizontal aria-hidden="true" /><strong>Mixer</strong></div>
      <label className="dj-pro-mixer__channel" data-deck="a">
        <span>Channel A</span>
        <input type="range" min="0" max="1" step="0.01" value={mixer.channelVolumes.a} onChange={event => onChannelVolume('a', Number(event.currentTarget.value))} />
        <strong>{Math.round(mixer.channelVolumes.a * 100)}%</strong>
      </label>
      <label className="dj-pro-mixer__crossfader">
        <span>Crossfader</span>
        <div><small>A</small><input type="range" min="-1" max="1" step="0.01" value={mixer.crossfader} onChange={event => onCrossfader(Number(event.currentTarget.value))} /><small>B</small></div>
        <strong>{mixer.crossfader === 0 ? 'Centro' : mixer.crossfader < 0 ? `A ${Math.round(Math.abs(mixer.crossfader) * 100)}%` : `B ${Math.round(mixer.crossfader * 100)}%`}</strong>
      </label>
      <label className="dj-pro-mixer__channel" data-deck="b">
        <span>Channel B</span>
        <input type="range" min="0" max="1" step="0.01" value={mixer.channelVolumes.b} onChange={event => onChannelVolume('b', Number(event.currentTarget.value))} />
        <strong>{Math.round(mixer.channelVolumes.b * 100)}%</strong>
      </label>
    </section>
  );
}

export function DjModeScreen({
  decks,
  mixer,
  libraryTracks,
  libraryFolders,
  selectedFolderPath,
  onSelectFolderPath,
  selectedLibraryIndex,
  onSelectLibraryIndex,
  onLoadSelectedTrack,
  midi,
  onDisconnectMidi,
  onSelectMidiOutput,
  onChannelVolume,
  onCrossfader,
  onTogglePlay,
  onCue,
  onSync,
  mixMode,
  onMixModeChange,
  onExit
}: DjModeScreenProps) {
  return (
    <section className="dj-mode dj-mode--prototype-three" aria-label="Modo DJ">
      <header className="dj-mode__header">
        <div className="dj-mode__brand">
          <span className="dj-mode__brand-icon" aria-hidden="true"><Disc3 /></span>
          <div><strong>Modo DJ</strong><small>Dual-deck</small></div>
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
        <DeckPanel deck="a" state={decks.a} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} />
        <DjLibrary
          tracks={libraryTracks}
          folders={libraryFolders}
          selectedFolderPath={selectedFolderPath}
          onSelectFolderPath={onSelectFolderPath}
          selectedIndex={selectedLibraryIndex}
          onSelect={onSelectLibraryIndex}
          onLoad={onLoadSelectedTrack}
        />
        <DeckPanel deck="b" state={decks.b} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} />
        <DjMixer mixer={mixer} onChannelVolume={onChannelVolume} onCrossfader={onCrossfader} />
        <DjMidiPanel midi={midi} onDisconnect={onDisconnectMidi} onSelectOutput={onSelectMidiOutput} />
      </main>
    </section>
  );
}
