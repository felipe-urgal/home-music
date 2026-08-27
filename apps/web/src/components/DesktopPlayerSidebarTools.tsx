import { useState } from 'react';
import type { NormalizationMode, Track } from '@home-music/shared';
import { CheckCircle2, LogOut, Settings2, UserRound } from 'lucide-react';
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

type DesktopPlayerSidebarToolsProps = {
  username: string;
  current?: Track | null;
  accountActive?: boolean;
  streamingSelection: StreamingSelection;
  effectiveStreamingMode: StreamingMode;
  networkPreference: NetworkPreference;
  detectedNetwork: DetectedNetwork;
  normalizationMode: NormalizationMode;
  effectiveNormalizationMode: NormalizationMode;
  onStreamingSelection: (selection: StreamingSelection) => void;
  onNetworkPreference: (preference: NetworkPreference) => void;
  onNormalizationMode: (mode: NormalizationMode) => void;
  onOpenAccount: () => void;
  onLogout?: () => void;
};

export function DesktopPlayerSidebarTools({
  username,
  current,
  accountActive = false,
  streamingSelection,
  effectiveStreamingMode,
  networkPreference,
  detectedNetwork,
  normalizationMode,
  effectiveNormalizationMode,
  onStreamingSelection,
  onNetworkPreference,
  onNormalizationMode,
  onOpenAccount,
  onLogout
}: DesktopPlayerSidebarToolsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="desktop-player-sidebar-tools">
      <button
        className={`desktop-player-sidebar-tools__button ${open ? 'is-active' : ''}`}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
      >
        <Settings2 />
        <span>Reprodução</span>
      </button>

      {open && (
        <section className="desktop-playback-settings" aria-label="Preferências de reprodução">
          <div className="desktop-playback-settings__heading"><strong>Reprodução</strong><small>Preferências deste dispositivo</small></div>
          <div className="desktop-playback-settings__section">
            <span className="desktop-playback-settings__label">Qualidade</span>
            <div className="desktop-playback-settings__choices">
              {STREAMING_CHOICES.map(choice => (
                <button key={choice.mode} className={streamingSelection === choice.mode ? 'is-selected' : ''} type="button" aria-pressed={streamingSelection === choice.mode} onClick={() => onStreamingSelection(choice.mode)}>
                  <span><strong>{choice.label}</strong><small>{choice.detail}</small></span>
                  {streamingSelection === choice.mode && <CheckCircle2 aria-hidden="true" />}
                </button>
              ))}
            </div>
            {streamingSelection === 'network' && (
              <div className="desktop-playback-settings__network">
                <label><span>Conexão atual</span><select value={networkPreference} onChange={event => onNetworkPreference(event.target.value as NetworkPreference)}><option value="auto">Detectar</option><option value="wifi">Wi-Fi</option><option value="mobile">Dados móveis</option></select></label>
                <small>Rede detectada: {detectedNetworkLabel(detectedNetwork)} · {streamingModeLabel(effectiveStreamingMode)}</small>
              </div>
            )}
          </div>
          <div className="desktop-playback-settings__section">
            <span className="desktop-playback-settings__label">Normalização</span>
            <div className="desktop-playback-settings__choices">
              {NORMALIZATION_CHOICES.map(choice => {
                const unavailable = current ? (choice.mode === 'track'
                  ? current.replayGainTrackDb == null
                  : choice.mode === 'album'
                    ? current.replayGainAlbumDb == null && current.replayGainTrackDb == null
                    : false) : false;
                return (
                  <button key={choice.mode} className={normalizationMode === choice.mode ? 'is-selected' : ''} type="button" aria-pressed={normalizationMode === choice.mode} disabled={unavailable} onClick={() => onNormalizationMode(choice.mode)}>
                    <span><strong>{choice.label}</strong><small>{unavailable ? 'Esta faixa não possui tags ReplayGain' : choice.detail}</small></span>
                    {normalizationMode === choice.mode && <CheckCircle2 aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            {normalizationMode !== 'off' && effectiveNormalizationMode === 'off' && <small className="desktop-playback-settings__note">A preferência está salva, mas esta faixa será reproduzida sem normalização.</small>}
          </div>
        </section>
      )}

      <button className={`desktop-player-sidebar-tools__account ${accountActive ? 'is-active' : ''}`} type="button" aria-current={accountActive ? 'page' : undefined} onClick={onOpenAccount}>
        <UserRound />
        <span><strong>Minha conta</strong><small>{username}</small></span>
      </button>

      {onLogout && (
        <button className="desktop-player-sidebar-tools__logout" type="button" onClick={onLogout}>
          <LogOut />
          <span>Sair da conta</span>
        </button>
      )}
    </div>
  );
}
