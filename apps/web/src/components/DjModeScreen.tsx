import type { Track } from '@home-music/shared';
import { ArrowLeft, Disc3, Pause, Play, RotateCcw, SlidersHorizontal, Zap } from 'lucide-react';
import type { DjDeckId } from '../dj-controller-contract';
import type { DualDeckAudioSnapshot } from '../dual-deck-audio';
import type { DualDeckMixerState } from '../dual-deck-mixer';

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

export function DjModeScreen({
  decks,
  mixer,
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
        <button className="dj-mode__exit" type="button" onClick={onExit}>
          <ArrowLeft aria-hidden="true" /><span>Sair do modo DJ</span>
        </button>
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
        <div><strong>Biblioteca</strong><span>Seleção e LOAD A/B entram na etapa dedicada.</span></div>
        <div><strong>Controlador MIDI</strong><span>Status e diagnóstico entram na etapa dedicada.</span></div>
      </footer>
    </section>
  );
}
