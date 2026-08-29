import { useMemo, useState } from 'react';
import type {
  ImportJob,
  ImportMediaDecisionReason,
  ImportOutputProfile
} from '@home-music/shared';
import { CheckCircle2, Gauge, LoaderCircle, ShieldCheck } from 'lucide-react';
import {
  validateAdminImportMedia,
  type AdminImportMediaValidationConfig
} from '../admin-import-client';

type AdminImportMediaValidationPanelProps = {
  jobs: ImportJob[];
  config: AdminImportMediaValidationConfig;
  onJobUpdated: (job: ImportJob) => void;
  onRefresh: () => Promise<void>;
};

const REASON_LABELS: Record<ImportMediaDecisionReason, string> = {
  'original-compatible': 'origem já compatível',
  'already-economical': 'origem já econômica',
  'already-compatible': 'origem já no perfil compatível',
  'economy-requested': 'economia solicitada',
  'compatibility-requested': 'compatibilidade solicitada',
  'unsupported-original': 'container original precisava normalização',
  'contains-video': 'faixa de vídeo removida',
  'multiple-audio-streams': 'melhor faixa de áudio selecionada'
};

const PROFILE_FALLBACK_LABELS: Record<ImportOutputProfile, string> = {
  original: 'Original',
  economy: 'Economizar espaço',
  compatibility: 'Compatibilidade máxima'
};

function formatBitRate(value: number | null) {
  if (!value || value <= 0) return null;
  return `${Math.round(value / 1000)} kbps`;
}

function mediaFormat(codec: string, extension: string, bitRate: number | null) {
  return [codec.toUpperCase(), extension.replace('.', '').toUpperCase(), formatBitRate(bitRate)]
    .filter(Boolean)
    .join(' · ');
}

export function AdminImportMediaDecisionSummary({ job }: { job: ImportJob }) {
  const decision = job.mediaDecision;
  if (!decision) return null;
  const action = decision.action === 'preserve' ? 'Preservar' : 'Converter';
  const prefix = job.status === 'failed' ? 'Plano técnico' : 'Decisão técnica';
  return (
    <small className={`admin-import-job__decision${job.status === 'failed' ? ' is-planned' : ''}`}>
      {prefix}: {action} · {mediaFormat(decision.output.codec, decision.output.extension, decision.output.bitRate)} · {REASON_LABELS[decision.reason]}
    </small>
  );
}

export function AdminImportMediaValidationPanel({
  jobs,
  config,
  onJobUpdated,
  onRefresh
}: AdminImportMediaValidationPanelProps) {
  const defaultProfile = config.profiles.some(profile => profile.id === 'original')
    ? 'original'
    : config.profiles[0]?.id ?? 'original';
  const [selectedProfile, setSelectedProfile] = useState<ImportOutputProfile>(defaultProfile);
  const [validatingJobId, setValidatingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pendingJobs = useMemo(
    () => jobs.filter(job => job.status === 'pending' && !job.mediaDecision),
    [jobs]
  );
  const validatedCount = useMemo(
    () => jobs.filter(job => job.mediaDecision && job.status !== 'failed').length,
    [jobs]
  );

  const validateJob = async (job: ImportJob) => {
    if (validatingJobId) return;
    setError(null);
    setValidatingJobId(job.id);
    try {
      const result = await validateAdminImportMedia(job.id, selectedProfile);
      onJobUpdated(result.job);
    } catch (caught) {
      await onRefresh().catch(() => undefined);
      setError(caught instanceof Error ? caught.message : 'Não foi possível validar a mídia.');
    } finally {
      setValidatingJobId(null);
    }
  };

  return (
    <section className="admin-import-validation" aria-labelledby="admin-import-validation-title">
      <div className="admin-import-validation__heading">
        <div>
          <span className="my-account-link-group__label">Validação técnica</span>
          <strong id="admin-import-validation-title">Formato de saída</strong>
          <small>Original é o padrão. O servidor só converte quando o perfil ou a segurança técnica exigirem.</small>
        </div>
        <span className="admin-import-validation__counter">
          <ShieldCheck /> {validatedCount} validada{validatedCount === 1 ? '' : 's'}
        </span>
      </div>

      <div className="admin-import-profile-grid" role="radiogroup" aria-label="Perfil de saída da importação">
        {config.profiles.map(profile => (
          <label
            className={`admin-import-profile${selectedProfile === profile.id ? ' is-selected' : ''}`}
            key={profile.id}
          >
            <input
              type="radio"
              name="admin-import-profile"
              value={profile.id}
              checked={selectedProfile === profile.id}
              disabled={Boolean(validatingJobId)}
              onChange={() => setSelectedProfile(profile.id)}
            />
            <span className="admin-import-profile__icon">
              {profile.id === 'original' ? <ShieldCheck /> : profile.id === 'economy' ? <Gauge /> : <CheckCircle2 />}
            </span>
            <span>
              <strong>{profile.label || PROFILE_FALLBACK_LABELS[profile.id]}</strong>
              <small>{profile.description}</small>
            </span>
          </label>
        ))}
      </div>

      <div className="admin-import-validation__queue">
        <div className="admin-import-validation__queue-heading">
          <strong>Aguardando validação</strong>
          <small>{pendingJobs.length} {pendingJobs.length === 1 ? 'arquivo' : 'arquivos'}</small>
        </div>

        {pendingJobs.length === 0 ? (
          <div className="admin-import-validation__empty">
            <CheckCircle2 />
            <span>Nenhuma mídia pendente de validação técnica.</span>
          </div>
        ) : (
          <div className="admin-import-validation__jobs">
            {pendingJobs.map(job => {
              const validating = validatingJobId === job.id;
              return (
                <article className="admin-import-validation-job" key={job.id}>
                  <div>
                    <strong>{job.label}</strong>
                    <small>{PROFILE_FALLBACK_LABELS[selectedProfile]} · FFprobe antes e depois quando houver conversão</small>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(validatingJobId)}
                    onClick={() => void validateJob(job)}
                  >
                    {validating ? <LoaderCircle className="is-spinning" /> : <ShieldCheck />}
                    {validating ? 'Validando…' : 'Validar mídia'}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}
    </section>
  );
}
