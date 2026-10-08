import type {
  LibraryAssistantReviewMode,
  LibraryAssistantReviewPolicy,
  LibraryAssistantReviewPolicyKey
} from '@home-music/shared/library-assistant';
import { LoaderCircle, ShieldCheck, X } from 'lucide-react';
import type { LibraryAssistantAutonomyState } from '../library-assistant-client';

type PolicyRow = {
  key: LibraryAssistantReviewPolicyKey;
  label: string;
  description: string;
  allowBulk: boolean;
};

const POLICY_MODES: readonly [LibraryAssistantReviewMode, string][] = [
  ['ignore', 'Ocultar'],
  ['review', 'Revisar individualmente'],
  ['bulk', 'Permitir lote seguro']
];
const POLICY_ROWS: readonly PolicyRow[] = [
  {
    key: 'title',
    label: 'Título',
    description: 'Sugestões que alteram o título da faixa.',
    allowBulk: true
  },
  {
    key: 'artist',
    label: 'Artista',
    description: 'Sugestões que alteram o artista da faixa.',
    allowBulk: true
  },
  {
    key: 'album',
    label: 'Álbum',
    description: 'Sugestões que alteram o nome do álbum.',
    allowBulk: true
  },
  {
    key: 'albumArtist',
    label: 'Artista do álbum',
    description: 'Sugestões que alteram o artista do álbum.',
    allowBulk: true
  },
  {
    key: 'artwork',
    label: 'Capas',
    description: 'Capas continuam com aplicação individual após conferir a imagem.',
    allowBulk: false
  },
  {
    key: 'lyrics',
    label: 'Letras',
    description: 'Letras encontradas para faixas sem uma letra efetiva.',
    allowBulk: true
  }
];


type Props = {
  policy: LibraryAssistantReviewPolicy;
  policyReady: boolean;
  savingPolicy: boolean;
  autonomy: LibraryAssistantAutonomyState | null;
  savingAutonomy: boolean;
  onClose: () => void;
  onPolicyMode: (key: LibraryAssistantReviewPolicyKey, mode: LibraryAssistantReviewMode) => void;
  onToggleAutonomy: () => void;
};

export function AdminLibraryAssistantSettingsPanel({
  policy, policyReady, savingPolicy, autonomy, savingAutonomy,
  onClose, onPolicyMode, onToggleAutonomy
}: Props) {
  return (
        <section className="assistant-tabs__settings">
          <header>
            <div>
              <strong>Configurações</strong>
              <small>Controle quais sugestões aparecem e o comportamento automático seguro.</small>
            </div>
            <button type="button" onClick={onClose}><X /> Fechar</button>
          </header>

          <div className="assistant-tabs__settings-grid">
            <section>
              <strong>Política de revisão</strong>
              <p>“Ocultar” remove a sugestão da fila visual; “Revisar” mantém decisão individual; “Lote seguro” permite aplicar apenas resultados de alta confiança.</p>
              <div className="assistant-tabs__policy-list">
                {POLICY_ROWS.map(row => (
                  <fieldset key={row.key} disabled={!policyReady || savingPolicy}>
                    <legend>{row.label}</legend>
                    <small>{row.description}</small>
                    <div>
                      {POLICY_MODES.filter(([mode]) => row.allowBulk || mode !== 'bulk').map(([mode, label]) => (
                        <label key={mode}>
                          <input
                            type="radio"
                            name={`assistant-tab-policy-${row.key}`}
                            checked={policy[row.key] === mode}
                            onChange={() => onPolicyMode(row.key, mode)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>

            <section className="assistant-tabs__automation">
              <strong>Automação segura</strong>
              <p>Quando ativa, somente campos de metadata vazios e sugestões de alta confiança podem ser preenchidos automaticamente. Capas, letras e campos já preenchidos continuam manuais.</p>
              <button type="button" disabled={!autonomy || savingAutonomy} onClick={onToggleAutonomy}>
                {savingAutonomy ? <LoaderCircle className="is-spinning" /> : <ShieldCheck />}
                {autonomy?.config.enabled ? 'Desativar automação' : 'Ativar automação segura'}
              </button>
            </section>
          </div>
        </section>
  );
}
