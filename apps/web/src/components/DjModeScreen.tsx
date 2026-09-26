import type { Track } from '@home-music/shared';
import { ArrowLeft, Disc3, Keyboard, Pause, Play, RotateCcw, SlidersHorizontal, Zap } from 'lucide-react';
import type { DjDeckId } from '../dj-controller-contract';
import type { DualDeckAudioSnapshot } from '../dual-deck-audio';
import type { DualDeckMixerState } from '../dual-deck-mixer';
import type { WebMidiController } from '../useWebMidiController';

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
  const confidence = state.track?.rhythm?.confidence ?? null;
  const rate = snapshot?.playbackRate ?? 1;

  return (
    <article className="dj-mode__deck" aria-label={label} data-deck={deck} data-playing={playing ? 'true' : 'false'}>
      <div className="dj-mode__deck-heading">
        <span>{label}</span>
        <small>{side}</small>
      </div>

      {!loaded ? (
        <div className="dj-mode__deck-empty">
          <Disc3 aria-hidden="true" />
          <strong>Nenhuma faixa carregada</strong>
          <span>Carregue uma faixa pela biblioteca ou pela controladora.</span>
        </div>
      ) : (
        <div className="dj-deck-panel">
          <div className="dj-deck-panel__track">
            <div className="dj-deck-panel__disc" aria-hidden="true"><Disc3 /></div>
            <div>
              <strong>{state.track?.title}</strong>
              <span>{state.track?.artist || 'Artista desconhecido'}</span>
            </div>
          </div>

          <div className="dj-deck-panel__timeline">
            <div className="dj-deck-panel__time">
              <span>{formatTime(snapshot?.currentTimeSeconds ?? 0)}</span>
              <span>{formatTime(snapshot?.durationSeconds ?? state.track?.duration ?? 0)}</span>
            </div>
            <div className="dj-deck-panel__progress" aria-label="Progresso da faixa">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="dj-deck-panel__metrics">
            <div><span>BPM</span><strong>{bpm ? bpm.toFixed(1) : '—'}</strong></div>
            <div><span>Pitch</span><strong>{pitchPercent(rate) >= 0 ? '+' : ''}{pitchPercent(rate).toFixed(2)}%</strong></div>
            <div><span>Rate</span><strong>{rate.toFixed(3)}×</strong></div>
            <div><span>Canal</span><strong>{Math.round(state.channelVolume * 100)}%</strong></div>
          </div>

          <div className="dj-deck-panel__secondary">
            <span>Confidence: {confidence == null ? '—' : `${Math.round(confidence * 100)}%`}</span>
            <span>CUE: {state.cuePointSeconds == null ? 'não definido' : formatTime(state.cuePointSeconds)}</span>
          </div>

          <div className="dj-deck-panel__controls">
            <button
              type="button"
              className={playing ? 'is-active' : ''}
              aria-label={playing ? `Pausar ${label}` : `Reproduzir ${label}`}
              onClick={() => onTogglePlay(deck)}
            >
              {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              className={state.cuePointSeconds != null ? 'is-active' : ''}
              onClick={() => onCue(deck)}
            >
              <RotateCcw aria-hidden="true" />
              <span>CUE</span>
            </button>
            <button
              type="button"
              className={state.syncActive ? 'is-active' : ''}
              aria-pressed={state.syncActive}
              onClick={() => onSync(deck)}
            >
              <Zap aria-hidden="true" />
              <span>SYNC</span>
            </button>
          </div>
        </div>
      )}
    </article>
  );
}


function DjLibrary({
  tracks,
  selectedIndex,
  onSelect,
  onLoad
}: {
  tracks: Track[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onLoad: (deck: DjDeckId) => void;
}) {
  if (!tracks.length) {
    return (
      <section className="dj-library" aria-label="Biblioteca DJ">
        <div className="dj-library__heading">
          <div><strong>Biblioteca</strong><span>Nenhuma faixa disponível.</span></div>
        </div>
      </section>
    );
  }

  const safeIndex = Math.max(0, Math.min(tracks.length - 1, selectedIndex));
  const windowSize = 18;
  const before = 6;
  const start = Math.max(0, Math.min(safeIndex - before, tracks.length - windowSize));
  const visibleTracks = tracks.slice(start, start + windowSize);
  const selected = tracks[safeIndex];

  return (
    <section className="dj-library" aria-label="Biblioteca DJ">
      <div className="dj-library__heading">
        <div>
          <strong>Biblioteca</strong>
          <span>{tracks.length} {tracks.length === 1 ? 'faixa' : 'faixas'} · seleção {safeIndex + 1}</span>
        </div>
        <div className="dj-library__load-actions">
          <button type="button" disabled={!selected} onClick={() => onLoad('a')}>LOAD A</button>
          <button type="button" disabled={!selected} onClick={() => onLoad('b')}>LOAD B</button>
        </div>
      </div>

      <div className="dj-library__list" role="listbox" aria-label="Faixas">
        {visibleTracks.map((track, offset) => {
          const index = start + offset;
          const selectedRow = index === safeIndex;
          return (
            <button
              key={track.id}
              type="button"
              role="option"
              aria-selected={selectedRow}
              className={selectedRow ? 'is-selected' : ''}
              onClick={() => onSelect(index)}
            >
              <span className="dj-library__index">{String(index + 1).padStart(2, '0')}</span>
              <span className="dj-library__track">
                <strong>{track.title}</strong>
                <small>{track.artist || 'Artista desconhecido'}</small>
              </span>
              <span className="dj-library__bpm">{track.rhythm?.bpm ? track.rhythm.bpm.toFixed(1) : '—'} BPM</span>
            </button>
          );
        })}
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
  const input = midi.inputs.find(port => port.id === midi.selectedInputId) ?? null;
  const output = midi.outputs.find(port => port.id === midi.selectedOutputId) ?? null;

  return (
    <section className="dj-midi" aria-label="Controlador MIDI">
      <div className="dj-midi__heading">
        <div>
          <strong>Controlador MIDI</strong>
          <span>{midi.supported ? midiStatusText(midi.status) : 'Web MIDI indisponível'}</span>
        </div>
        <span className={`dj-midi__status ${midi.status === 'connected' ? 'is-connected' : ''}`} aria-hidden="true" />
      </div>

      {!midi.supported ? (
        <p className="dj-midi__note">Use um navegador compatível em contexto seguro.</p>
      ) : midi.status !== 'connected' ? (
        <button
          className="dj-midi__action"
          type="button"
          disabled={midi.status === 'connecting'}
          onClick={() => void midi.connect()}
        >
          {midi.status === 'connecting' ? 'Conectando…' : 'Conectar controlador'}
        </button>
      ) : (
        <>
          <label className="dj-midi__field">
            <span>Entrada</span>
            <select
              value={midi.selectedInputId ?? ''}
              onChange={event => midi.selectInput(event.currentTarget.value || null)}
            >
              <option value="">Nenhuma</option>
              {midi.inputs.map(port => (
                <option key={port.id} value={port.id} disabled={port.state !== 'connected'}>
                  {port.name}{port.manufacturer ? ` — ${port.manufacturer}` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="dj-midi__field">
            <span>Saída</span>
            <select
              value={midi.selectedOutputId ?? ''}
              onChange={event => onSelectOutput(event.currentTarget.value || null)}
            >
              <option value="">Nenhuma</option>
              {midi.outputs.map(port => (
                <option key={port.id} value={port.id} disabled={port.state !== 'connected'}>
                  {port.name}{port.manufacturer ? ` — ${port.manufacturer}` : ''}
                </option>
              ))}
            </select>
          </label>

          <div className="dj-midi__ports">
            <span>IN: {input?.name ?? 'nenhuma'}</span>
            <span>OUT: {output?.name ?? 'nenhuma'}</span>
          </div>

          <label className="dj-midi__diagnostics">
            <input
              type="checkbox"
              checked={midi.diagnosticsEnabled}
              onChange={event => midi.setDiagnosticsEnabled(event.currentTarget.checked)}
            />
            <span>Diagnóstico local</span>
          </label>

          {midi.diagnosticsEnabled && (
            <div className="dj-midi__event" aria-live="polite">
              {midi.lastMessage
                ? <>status {midi.lastMessage.status} · canal {midi.lastMessage.channel + 1} · data1 {midi.lastMessage.data1} · data2 {midi.lastMessage.data2}</>
                : 'Aguardando evento MIDI…'}
            </div>
          )}

          <button className="dj-midi__action is-secondary" type="button" onClick={onDisconnect}>
            Desconectar
          </button>
        </>
      )}
    </section>
  );
}

export function DjModeScreen({
  decks,
  mixer,
  libraryTracks,
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
  onExit
}: DjModeScreenProps) {
  return (
    <section className="dj-mode" aria-label="Modo DJ">
      <header className="dj-mode__header">
        <div className="dj-mode__brand">
          <span className="dj-mode__brand-icon" aria-hidden="true"><Disc3 /></span>
          <div><strong>Modo DJ</strong><small>Dual-deck</small></div>
        </div>
        <div className="dj-mode__header-actions">
          <details className="dj-shortcuts">
            <summary>
              <Keyboard aria-hidden="true" />
              <span>Atalhos</span>
            </summary>
            <div className="dj-shortcuts__panel">
              <div><strong>Decks</strong><span><kbd>1</kbd>/<kbd>2</kbd> Play · <kbd>Q</kbd>/<kbd>W</kbd> Cue · <kbd>A</kbd>/<kbd>S</kbd> Sync</span></div>
              <div><strong>Biblioteca</strong><span><kbd>←</kbd>/<kbd>→</kbd> Seleção · <kbd>Z</kbd>/<kbd>X</kbd> Load A/B</span></div>
              <div><strong>Nudge</strong><span><kbd>R</kbd>/<kbd>T</kbd> Deck A · <kbd>Y</kbd>/<kbd>U</kbd> Deck B</span></div>
              <div><strong>Mixer</strong><span><kbd>F</kbd>/<kbd>G</kbd> Canal A · <kbd>H</kbd>/<kbd>J</kbd> Canal B · <kbd>,</kbd>/<kbd>.</kbd> Crossfader</span></div>
            </div>
          </details>
          <button className="dj-mode__exit" type="button" onClick={onExit}>
            <ArrowLeft aria-hidden="true" /><span>Sair do modo DJ</span>
          </button>
        </div>
      </header>

      <div className="dj-mode__workspace">
        <DeckPanel deck="a" state={decks.a} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} />

        <section className="dj-mode__mixer" aria-label="Mixer">
          <div className="dj-mode__mixer-heading">
            <SlidersHorizontal aria-hidden="true" /><span>Mixer</span>
          </div>

          <div className="dj-mixer">
            <label className="dj-mixer__channel">
              <span>Channel A</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={mixer.channelVolumes.a}
                aria-label="Volume do Channel A"
                aria-valuetext={`${Math.round(mixer.channelVolumes.a * 100)}%`}
                onChange={event => onChannelVolume('a', Number(event.currentTarget.value))}
              />
              <strong>{Math.round(mixer.channelVolumes.a * 100)}%</strong>
            </label>

            <div className="dj-mixer__center">
              <span className="dj-mixer__mode">Manual</span>
              <div className="dj-mixer__crossfader">
                <div className="dj-mixer__crossfader-labels" aria-hidden="true">
                  <span>A</span><span>Crossfader</span><span>B</span>
                </div>
                <input
                  type="range"
                  min="-1"
                  max="1"
                  step="0.01"
                  value={mixer.crossfader}
                  aria-label="Crossfader"
                  aria-valuetext={mixer.crossfader === 0
                    ? 'Centro'
                    : mixer.crossfader < 0
                      ? `${Math.round(Math.abs(mixer.crossfader) * 100)}% para Deck A`
                      : `${Math.round(mixer.crossfader * 100)}% para Deck B`}
                  onChange={event => onCrossfader(Number(event.currentTarget.value))}
                />
              </div>
              <strong className="dj-mixer__crossfader-value">
                {mixer.crossfader === 0
                  ? 'Centro'
                  : mixer.crossfader < 0
                    ? `A ${Math.round(Math.abs(mixer.crossfader) * 100)}%`
                    : `B ${Math.round(mixer.crossfader * 100)}%`}
              </strong>
            </div>

            <label className="dj-mixer__channel">
              <span>Channel B</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={mixer.channelVolumes.b}
                aria-label="Volume do Channel B"
                aria-valuetext={`${Math.round(mixer.channelVolumes.b * 100)}%`}
                onChange={event => onChannelVolume('b', Number(event.currentTarget.value))}
              />
              <strong>{Math.round(mixer.channelVolumes.b * 100)}%</strong>
            </label>
          </div>
        </section>

        <DeckPanel deck="b" state={decks.b} onTogglePlay={onTogglePlay} onCue={onCue} onSync={onSync} />
      </div>

      <footer className="dj-mode__bottom-panel">
        <DjLibrary
          tracks={libraryTracks}
          selectedIndex={selectedLibraryIndex}
          onSelect={onSelectLibraryIndex}
          onLoad={onLoadSelectedTrack}
        />
        <DjMidiPanel midi={midi} onDisconnect={onDisconnectMidi} onSelectOutput={onSelectMidiOutput} />
      </footer>
    </section>
  );
}
