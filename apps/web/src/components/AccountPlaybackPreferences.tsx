import type { NormalizationMode, Track } from '@home-music/shared';
import { CheckCircle2, Music2, Play, ShieldCheck, Volume2, Wifi } from 'lucide-react';
import type {
  DetectedNetwork,
  NetworkPreference,
  StreamingMode,
  StreamingSelection
} from '../streaming-quality';

const STREAMING_CHOICES: Array<{ mode: StreamingSelection; label: string; detail: string }> = [
  { mode: 'network', label: 'Por conexão', detail: 'Wi-Fi auto · móvel 96 kbps' },
  { mode: 'auto', label: 'Automática', detail: 'Original + compatibilidade' },
  { mode: 'original', label: 'Original', detail: 'Sem conversão' },
  { mode: 'economy', label: 'Economia', detail: 'AAC · 96 kbps' }
];

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
  if (mode === 'economy') return 'Economia · AAC 96 kbps';
  if (mode === 'original') return 'Original';
  return 'Automática · original + compatibilidade';
}

function normalizationModeLabel(mode: NormalizationMode) {
  if (mode === 'track') return 'ReplayGain por faixa';
  if (mode === 'album') return 'ReplayGain por álbum';
  return 'Normalização desativada';
}

export type AccountPlaybackPreferencesValue = {
  current?: Track | null;
  streamingSelection: StreamingSelection;
  effectiveStreamingMode: StreamingMode;
  networkPreference: NetworkPreference;
  detectedNetwork: DetectedNetwork;
  normalizationMode: NormalizationMode;
  effectiveNormalizationMode: NormalizationMode;
  onStreamingSelection: (selection: StreamingSelection) => void;
  onNetworkPreference: (preference: NetworkPreference) => void;
  onNormalizationMode: (mode: NormalizationMode) => void;
};

type AccountPlaybackPreferencesProps = {
  value: AccountPlaybackPreferencesValue;
};

export function AccountPlaybackPreferences({ value }: AccountPlaybackPreferencesProps) {
  const {
    current,
    streamingSelection,
    effectiveStreamingMode,
    networkPreference,
    detectedNetwork,
    normalizationMode,
    effectiveNormalizationMode,
    onStreamingSelection,
    onNetworkPreference,
    onNormalizationMode
  } = value;

  return (
    <div className="account-playback-screen">
      <section className="account-playback-hero" aria-labelledby="account-playback-hero-title">
        <div className="account-playback-hero__copy">
          <span className="account-playback-hero__eyebrow">Preferências deste dispositivo</span>
          <strong id="account-playback-hero-title">Seu áudio, do seu jeito.</strong>
          <small>Escolha como o Home Music entrega e normaliza suas músicas neste aparelho.</small>
          <div className="account-playback-hero__status" aria-label="Configuração efetiva agora">
            <span><Music2 /> {streamingModeLabel(effectiveStreamingMode)}</span>
            <span><Volume2 /> {normalizationModeLabel(effectiveNormalizationMode)}</span>
          </div>
        </div>
        <div className="account-playback-hero__visual" aria-hidden="true">
          <span className="account-playback-hero__ring account-playback-hero__ring--outer" />
          <span className="account-playback-hero__ring account-playback-hero__ring--inner" />
          <span className="account-playback-hero__play"><Play /></span>
        </div>
      </section>

      <section className="account-playback-group" aria-labelledby="account-playback-quality-title">
        <div className="account-playback-group__heading">
          <span className="account-playback-group__icon"><Music2 /></span>
          <div>
            <strong id="account-playback-quality-title">Qualidade do áudio</strong>
            <small>Defina como o streaming deve ser entregue neste dispositivo.</small>
          </div>
        </div>

        <div className="account-playback-options">
          {STREAMING_CHOICES.map(choice => (
            <button
              key={choice.mode}
              className={streamingSelection === choice.mode ? 'is-selected' : ''}
              type="button"
              aria-pressed={streamingSelection === choice.mode}
              onClick={() => onStreamingSelection(choice.mode)}
            >
              <span className="account-playback-option__copy">
                <strong>{choice.label}</strong>
                <small>{choice.detail}</small>
              </span>
              {streamingSelection === choice.mode
                ? <CheckCircle2 className="account-playback-option__check" aria-hidden="true" />
                : <span className="account-playback-option__dot" aria-hidden="true" />}
            </button>
          ))}
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

      <section className="account-playback-group" aria-labelledby="account-playback-volume-title">
        <div className="account-playback-group__heading">
          <span className="account-playback-group__icon"><Volume2 /></span>
          <div>
            <strong id="account-playback-volume-title">Volume</strong>
            <small>Controle a consistência de volume com as tags ReplayGain da biblioteca.</small>
          </div>
        </div>

        <div className="account-playback-options">
          {NORMALIZATION_CHOICES.map(choice => {
            const unavailable = current ? (choice.mode === 'track'
              ? current.replayGainTrackDb == null
              : choice.mode === 'album'
                ? current.replayGainAlbumDb == null && current.replayGainTrackDb == null
                : false) : false;

            return (
              <button
                key={choice.mode}
                className={normalizationMode === choice.mode ? 'is-selected' : ''}
                type="button"
                aria-pressed={normalizationMode === choice.mode}
                disabled={unavailable}
                onClick={() => onNormalizationMode(choice.mode)}
              >
                <span className="account-playback-option__copy">
                  <strong>{choice.label}</strong>
                  <small>{unavailable ? 'A faixa atual não possui tags ReplayGain compatíveis' : choice.detail}</small>
                </span>
                {normalizationMode === choice.mode
                  ? <CheckCircle2 className="account-playback-option__check" aria-hidden="true" />
                  : <span className="account-playback-option__dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        {normalizationMode !== 'off' && effectiveNormalizationMode === 'off' && (
          <div className="account-playback-warning" role="status">
            <Volume2 />
            <span>A preferência está salva, mas a faixa atual será reproduzida sem normalização.</span>
          </div>
        )}
      </section>

      <aside className="account-playback-device-note">
        <ShieldCheck />
        <div>
          <strong>Preferência local</strong>
          <small>Estas escolhas são aplicadas neste dispositivo e podem ser ajustadas a qualquer momento.</small>
        </div>
      </aside>
    </div>
  );
}
