import type { NormalizationMode, Track } from '@home-music/shared';
import { CheckCircle2, Settings2 } from 'lucide-react';
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
    <section className="my-account-card my-account-playback-card" aria-label="Preferências de reprodução">
      <div className="my-account-card__heading">
        <span className="my-account-card__icon"><Settings2 /></span>
        <div><strong>Reprodução</strong><small>Qualidade, conexão e normalização deste dispositivo.</small></div>
      </div>

      <div className="my-account-playback-section">
        <div className="my-account-playback-section__heading">
          <strong>Qualidade</strong>
          <small>Escolha como o áudio é entregue neste dispositivo.</small>
        </div>
        <div className="my-account-playback-choices">
          {STREAMING_CHOICES.map(choice => (
            <button
              key={choice.mode}
              className={streamingSelection === choice.mode ? 'is-selected' : ''}
              type="button"
              aria-pressed={streamingSelection === choice.mode}
              onClick={() => onStreamingSelection(choice.mode)}
            >
              <span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
              {streamingSelection === choice.mode && <CheckCircle2 aria-hidden="true" />}
            </button>
          ))}
        </div>

        {streamingSelection === 'network' && (
          <div className="my-account-playback-network">
            <label>
              <span>Conexão atual</span>
              <select value={networkPreference} onChange={event => onNetworkPreference(event.target.value as NetworkPreference)}>
                <option value="auto">Detectar automaticamente</option>
                <option value="wifi">Wi-Fi</option>
                <option value="mobile">Dados móveis</option>
              </select>
            </label>
            <small>Rede detectada: {detectedNetworkLabel(detectedNetwork)} · {streamingModeLabel(effectiveStreamingMode)}</small>
          </div>
        )}
      </div>

      <div className="my-account-playback-section">
        <div className="my-account-playback-section__heading">
          <strong>Normalização</strong>
          <small>Controle a consistência de volume entre as músicas.</small>
        </div>
        <div className="my-account-playback-choices">
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
                <span>
                  <strong>{choice.label}</strong>
                  <small>{unavailable ? 'A faixa atual não possui tags ReplayGain' : choice.detail}</small>
                </span>
                {normalizationMode === choice.mode && <CheckCircle2 aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        {normalizationMode !== 'off' && effectiveNormalizationMode === 'off' && (
          <small className="my-account-playback-note">A preferência está salva, mas a faixa atual será reproduzida sem normalização.</small>
        )}
      </div>
    </section>
  );
}
