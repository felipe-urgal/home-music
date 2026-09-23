import type { NormalizationMode, Track } from '@home-music/shared';
import { ChevronLeft, FastForward, Music2, ShieldCheck, Volume2, Wifi } from 'lucide-react';
import { MAX_CROSSFADE_SECONDS } from '../crossfade';
import type {
  DetectedNetwork,
  NetworkPreference,
  StreamingMode,
  StreamingSelection
} from '../streaming-quality';
import { tvCrossfadeOptions } from '../tv-controls';
import { isTvMode } from '../tv-mode';

const STREAMING_CHOICES: Array<{ mode: StreamingSelection; label: string; detail: string }> = [
  { mode: 'network', label: 'Por conexão', detail: 'Wi-Fi auto · móvel 96 kbps' },
  { mode: 'auto', label: 'Automática', detail: 'Original + compatibilidade' },
  { mode: 'original', label: 'Original', detail: 'Sem conversão' },
  { mode: 'economy', label: 'Economia', detail: 'AAC · 96 kbps' }
];

const CROSSFADE_SECONDS = Array.from({ length: MAX_CROSSFADE_SECONDS + 1 }, (_, seconds) => seconds);

const NORMALIZATION_CHOICES: Array<{ mode: NormalizationMode; label: string; detail: string }> = [
  { mode: 'off', label: 'Desativada', detail: 'Sem ajuste de ganho' },
  { mode: 'track', label: 'Por faixa', detail: 'Volume consistente entre músicas' },
  { mode: 'album', label: 'Por álbum', detail: 'Preserva diferenças dentro do álbum' }
];

function detectedNetworkLabel(network: DetectedNetwork) {
  if (network === 'wifi') return 'Wi-Fi/rede rápida';
  if (network === 'mobile') return 'dados móveis/rede limitada';
  return 'não identificada';
}

function streamingModeLabel(mode: StreamingMode) {
  if (mode === 'economy') return 'Economia';
  if (mode === 'original') return 'Original';
  return 'Automática';
}

function normalizationModeLabel(mode: NormalizationMode) {
  if (mode === 'track') return 'Por faixa';
  if (mode === 'album') return 'Por álbum';
  return 'Desativada';
}

export type AccountPlaybackPreferencesValue = {
  current?: Track | null;
  streamingSelection: StreamingSelection;
  effectiveStreamingMode: StreamingMode;
  networkPreference: NetworkPreference;
  detectedNetwork: DetectedNetwork;
  crossfadeSeconds: number;
  normalizationMode: NormalizationMode;
  effectiveNormalizationMode: NormalizationMode;
  onStreamingSelection: (selection: StreamingSelection) => void;
  onNetworkPreference: (preference: NetworkPreference) => void;
  onCrossfadeSeconds: (seconds: number) => void;
  onNormalizationMode: (mode: NormalizationMode) => void;
};

type AccountPlaybackPreferencesProps = {
  value: AccountPlaybackPreferencesValue;
  onBack?: () => void;
};

function SelectionMark({ selected }: { selected: boolean }) {
  return <span className={`account-playback-radio${selected ? ' is-selected' : ''}`} aria-hidden="true"><i /></span>;
}

export function AccountPlaybackPreferences({ value, onBack }: AccountPlaybackPreferencesProps) {
  const {
    current,
    streamingSelection,
    effectiveStreamingMode,
    networkPreference,
    detectedNetwork,
    crossfadeSeconds,
    normalizationMode,
    effectiveNormalizationMode,
    onStreamingSelection,
    onNetworkPreference,
    onCrossfadeSeconds,
    onNormalizationMode
  } = value;
  const tvMode = isTvMode();
  const tvCrossfadeChoices = tvCrossfadeOptions(crossfadeSeconds);

  return (
    <div className="account-playback-screen" data-testid="account-playback-minimal">
      <header className="account-playback-page-header">
        <button className="account-playback-page-header__back" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="account-playback-page-header__title">
          <strong>Reprodução</strong>
          <small>Qualidade e normalização</small>
        </div>
        <div className="account-playback-page-header__intro">
          <strong>Seu áudio, do seu jeito.</strong>
          <small>Escolha como o Home Music entrega, mistura e normaliza suas músicas.</small>
        </div>
        <div className="account-playback-page-header__status" aria-label="Configuração efetiva agora">
          <span className="is-primary">
            <Music2 />
            <small>Qualidade atual</small>
            <strong>{streamingModeLabel(effectiveStreamingMode)}</strong>
          </span>
          <span>
            <Volume2 />
            <small>Normalização</small>
            <strong>{normalizationModeLabel(effectiveNormalizationMode)}</strong>
          </span>
        </div>
      </header>

      <section className="account-playback-panel" aria-labelledby="account-playback-quality-title">
        <div className="account-playback-panel__heading">
          <span className="account-playback-panel__icon"><Music2 /></span>
          <div>
            <strong id="account-playback-quality-title">Qualidade do áudio</strong>
            <small>Defina como o streaming deve ser entregue neste dispositivo.</small>
          </div>
        </div>

        <div className="account-playback-choice-grid account-playback-choice-grid--four">
          {STREAMING_CHOICES.map(choice => {
            const selected = streamingSelection === choice.mode;
            return (
              <button
                key={choice.mode}
                className={selected ? 'is-selected' : ''}
                type="button"
                aria-pressed={selected}
                onClick={() => onStreamingSelection(choice.mode)}
              >
                <SelectionMark selected={selected} />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{choice.detail}</small>
                </span>
              </button>
            );
          })}
        </div>

        {streamingSelection === 'network' && (
          <div className="account-playback-network">
            <div className="account-playback-network__heading">
              <Wifi />
              <div>
                <strong>Conexão</strong>
                <small>Rede detectada: {detectedNetworkLabel(detectedNetwork)}</small>
              </div>
            </div>
            <label>
              <span>Comportamento</span>
              <select value={networkPreference} onChange={event => onNetworkPreference(event.target.value as NetworkPreference)}>
                <option value="auto">Detectar automaticamente</option>
                <option value="wifi">Tratar como Wi-Fi</option>
                <option value="mobile">Tratar como dados móveis</option>
              </select>
            </label>
            <small className="account-playback-network__effective">Aplicado agora: {streamingModeLabel(effectiveStreamingMode)}</small>
          </div>
        )}
      </section>

      <section className="account-playback-panel" aria-labelledby="account-playback-transition-title">
        <div className="account-playback-panel__heading">
          <span className="account-playback-panel__icon"><FastForward /></span>
          <div>
            <strong id="account-playback-transition-title">Transição entre músicas</strong>
            <small>Escolha por quantos segundos o fim da faixa atual mistura com o começo da próxima.</small>
          </div>
        </div>

        <div className="account-playback-crossfade">
          <div className="account-playback-crossfade__copy">
            <strong>Crossfade</strong>
            <small>{crossfadeSeconds === 0 ? 'Desativado' : `${crossfadeSeconds} s de transição contínua`}</small>
          </div>

          {tvMode ? (
            <div className="account-playback-tv-crossfade" aria-label="Duração do crossfade em segundos">
              {tvCrossfadeChoices.map(seconds => (
                <button
                  key={seconds}
                  type="button"
                  className={crossfadeSeconds === seconds ? 'is-selected' : ''}
                  aria-pressed={crossfadeSeconds === seconds}
                  onClick={() => onCrossfadeSeconds(seconds)}
                >
                  {seconds === 0 ? 'Desligado' : `${seconds} s`}
                </button>
              ))}
            </div>
          ) : (
            <label className="account-playback-crossfade__control">
              <span>Duração</span>
              <select
                value={crossfadeSeconds}
                onChange={event => onCrossfadeSeconds(Number(event.target.value))}
                aria-label="Duração do crossfade em segundos"
              >
                {CROSSFADE_SECONDS.map(seconds => (
                  <option key={seconds} value={seconds}>
                    {seconds === 0 ? '0 s · desativado' : `${seconds} s`}
                  </option>
                ))}
              </select>
              <small>0 desativa · máximo {MAX_CROSSFADE_SECONDS} s neste dispositivo.</small>
            </label>
          )}
        </div>

        {crossfadeSeconds > 0 && (
          <div className="account-playback-warning" role="status">
            <span className="account-playback-warning__icon">i</span>
            <span>No iPhone/iPad e em segundo plano ou com a tela bloqueada, o Home Music mantém a troca de faixa normal para preservar compatibilidade.</span>
          </div>
        )}
      </section>

      <section className="account-playback-panel" aria-labelledby="account-playback-volume-title">
        <div className="account-playback-panel__heading">
          <span className="account-playback-panel__icon"><Volume2 /></span>
          <div>
            <strong id="account-playback-volume-title">Volume</strong>
            <small>Controle a consistência de volume com as tags ReplayGain da biblioteca.</small>
          </div>
        </div>

        <div className="account-playback-choice-grid account-playback-choice-grid--three">
          {NORMALIZATION_CHOICES.map(choice => {
            const unavailable = current ? (choice.mode === 'track'
              ? current.replayGainTrackDb == null
              : choice.mode === 'album'
                ? current.replayGainAlbumDb == null && current.replayGainTrackDb == null
                : false) : false;
            const selected = normalizationMode === choice.mode;

            return (
              <button
                key={choice.mode}
                className={selected ? 'is-selected' : ''}
                type="button"
                aria-pressed={selected}
                disabled={unavailable}
                onClick={() => onNormalizationMode(choice.mode)}
              >
                <SelectionMark selected={selected} />
                <span>
                  <strong>{choice.label}</strong>
                  <small>{unavailable ? 'A faixa atual não possui tags ReplayGain compatíveis' : choice.detail}</small>
                </span>
              </button>
            );
          })}
        </div>

        {normalizationMode !== 'off' && effectiveNormalizationMode === 'off' && (
          <div className="account-playback-warning" role="status">
            <span className="account-playback-warning__icon">i</span>
            <span>A preferência está salva, mas a faixa atual será reproduzida sem normalização.</span>
          </div>
        )}
      </section>

      <aside className="account-playback-device-note">
        <span className="account-playback-device-note__icon"><ShieldCheck /></span>
        <div>
          <strong>Preferência local</strong>
          <small>Estas escolhas são aplicadas neste dispositivo e podem ser ajustadas a qualquer momento.</small>
        </div>
      </aside>
    </div>
  );
}
