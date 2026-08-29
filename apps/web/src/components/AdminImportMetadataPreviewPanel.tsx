import { useState } from 'react';
import type {
  ImportJob,
  ImportMetadataFieldName,
  ImportMetadataFieldState,
  ImportMetadataPreview,
  ImportMetadataPreviewPatch
} from '@home-music/shared';
import {
  CheckCircle2,
  Image,
  LoaderCircle,
  Music2,
  Pencil,
  RotateCcw,
  ShieldCheck,
  X
} from 'lucide-react';
import {
  adminImportPreviewCoverUrl,
  extractAdminImportMetadata,
  updateAdminImportMetadata
} from '../admin-import-client';
import { AdminImportDuplicateCheckPanel } from './AdminImportDuplicateCheck';

type AdminImportMetadataPreviewPanelProps = {
  jobs: ImportJob[];
  onJobUpdated: (job: ImportJob) => void;
  onRefresh: () => Promise<void>;
  compact?: boolean;
};

type EditableDraft = Record<ImportMetadataFieldName, string>;

const FIELD_LABELS: Record<ImportMetadataFieldName, string> = {
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista do álbum'
};

const FIELD_STATES: Record<ImportMetadataFieldState, string> = {
  trusted: 'Arquivo',
  suggested: 'Sugestão',
  fallback: 'Fallback',
  missing: 'Ausente',
  conflict: 'Conflito',
  edited: 'Ajustado'
};

const FIELDS = Object.keys(FIELD_LABELS) as ImportMetadataFieldName[];
const REVIEW_STATES = new Set<ImportMetadataFieldState>(['missing', 'suggested', 'conflict']);

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Duração indisponível';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function previewDraft(preview: ImportMetadataPreview): EditableDraft {
  return {
    title: preview.effective.title ?? '',
    artist: preview.effective.artist ?? '',
    album: preview.effective.album ?? '',
    albumArtist: preview.effective.albumArtist ?? ''
  };
}

function uncertainFieldCount(preview: ImportMetadataPreview) {
  return FIELDS.filter(field => ['suggested', 'fallback', 'missing', 'conflict'].includes(preview.fieldStates[field])).length;
}

function essentialReviewNeeded(preview: ImportMetadataPreview) {
  if (!preview.effective.title?.trim() || !preview.effective.artist?.trim()) return true;
  return REVIEW_STATES.has(preview.fieldStates.title) || REVIEW_STATES.has(preview.fieldStates.artist);
}

export function AdminImportMetadataSummary({ job }: { job: ImportJob }) {
  const preview = job.metadataPreview;
  if (!preview) return null;
  const uncertain = uncertainFieldCount(preview);
  const title = preview.effective.title || 'Título não informado';
  const artist = preview.effective.artist || 'Artista não informado';
  return (
    <small className={`admin-import-job__metadata${uncertain ? ' is-review' : ''}`}>
      Preview: {title} · {artist}{uncertain ? ` · ${uncertain} para revisar` : ' · metadata confiável'}
    </small>
  );
}

function MetadataPreviewCard({
  job,
  onJobUpdated,
  compact
}: {
  job: ImportJob;
  onJobUpdated: (job: ImportJob) => void;
  compact: boolean;
}) {
  const preview = job.metadataPreview!;
  const mustReview = essentialReviewNeeded(preview);
  const [draft, setDraft] = useState<EditableDraft>(() => previewDraft(preview));
  const [editing, setEditing] = useState(() => compact && mustReview);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uncertain = uncertainFieldCount(preview);
  const hasOverrides = FIELDS.some(field => Boolean(preview.overrides[field]));
  const hasExternalHints = FIELDS.some(field => ['suggested', 'conflict'].includes(preview.fieldStates[field]));

  const save = async () => {
    if (saving) return;
    const patch: ImportMetadataPreviewPatch = {};
    for (const field of FIELDS) {
      const next = draft[field].trim();
      const current = preview.effective[field] ?? '';
      if (next === current) continue;
      if (next) {
        patch[field] = next;
        continue;
      }
      if (preview.overrides[field]) {
        patch[field] = null;
        continue;
      }
      if (field === 'title' || field === 'artist') {
        setError(`${FIELD_LABELS[field]} é necessário para concluir esta importação.`);
        return;
      }
    }

    if (Object.keys(patch).length === 0) {
      setError(null);
      if (!mustReview) setEditing(false);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await updateAdminImportMetadata(job.id, patch);
      setDraft(previewDraft(result.preview));
      onJobUpdated(result.job);
      if (!essentialReviewNeeded(result.preview)) setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível salvar os ajustes.');
    } finally {
      setSaving(false);
    }
  };

  const restore = async () => {
    if (saving || !hasOverrides) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateAdminImportMetadata(job.id, {
        title: null,
        artist: null,
        album: null,
        albumArtist: null
      });
      setDraft(previewDraft(result.preview));
      onJobUpdated(result.job);
      setEditing(essentialReviewNeeded(result.preview));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível restaurar a leitura original.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`admin-import-metadata-card${compact ? ' is-compact' : ''}`}>
      <div className="admin-import-metadata-card__summary">
        <div className="admin-import-metadata-cover">
          {preview.cover.available ? (
            <img src={adminImportPreviewCoverUrl(job)} alt="Capa encontrada na mídia" loading="lazy" />
          ) : (
            <span aria-label="Sem capa"><Music2 /></span>
          )}
        </div>
        <div className="admin-import-metadata-card__identity">
          <small>{job.source.type === 'provider' ? 'Fonte externa' : job.source.type === 'url' ? 'URL direta' : 'Arquivo local'}</small>
          <strong>{preview.effective.title || 'Título não informado'}</strong>
          <span>{preview.effective.artist || 'Artista não informado'}</span>
          <div className="admin-import-metadata-card__facts">
            <span>{formatDuration(preview.durationSeconds)}</span>
            {job.mediaDecision?.output.codec && <span>{job.mediaDecision.output.codec.toUpperCase()}</span>}
            {job.mediaDecision?.output.bitRate && <span>{Math.round(job.mediaDecision.output.bitRate / 1000)} kbps</span>}
            {!compact && <span>{preview.cover.available ? <><Image /> Capa embutida</> : 'Sem capa confiável'}</span>}
            {mustReview && <span className="is-review">Revisão necessária</span>}
          </div>
        </div>
        {compact && (
          <button
            className="admin-import-metadata-card__edit-toggle"
            type="button"
            disabled={saving}
            onClick={() => {
              setEditing(current => !current);
              setError(null);
            }}
          >
            {editing ? <X /> : <Pencil />}
            {editing ? 'Fechar' : 'Alterar'}
          </button>
        )}
      </div>

      {(!compact || editing) && hasExternalHints && (
        <div className="admin-import-metadata-notice">
          <ShieldCheck />
          <span>Sugestões externas só entram após validação ou ajuste explícito.</span>
        </div>
      )}

      {(!compact || editing) && (
        <>
          <div className="admin-import-metadata-fields">
            {FIELDS.map(field => {
              const state = preview.fieldStates[field];
              const providerValue = preview.provider?.[field] ?? null;
              const showProvider = Boolean(providerValue && ['suggested', 'conflict'].includes(state));
              const inputId = `admin-import-metadata-${job.id}-${field}`;
              return (
                <div className={`admin-import-metadata-field is-${state}`} key={field}>
                  <label htmlFor={inputId}>
                    <strong>{FIELD_LABELS[field]}</strong>
                    <small>{FIELD_STATES[state]}</small>
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    maxLength={240}
                    value={draft[field]}
                    placeholder={`${FIELD_LABELS[field]} não informado`}
                    disabled={saving}
                    onChange={event => {
                      setDraft(current => ({ ...current, [field]: event.target.value }));
                      if (error) setError(null);
                    }}
                  />
                  {showProvider && providerValue && (
                    <div className="admin-import-metadata-field__hint">
                      <small>Provider sugeriu: {providerValue}</small>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          setDraft(current => ({ ...current, [field]: providerValue }));
                          if (error) setError(null);
                        }}
                      >
                        Usar sugestão
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="admin-import-metadata-card__actions">
            <button type="button" disabled={saving || !hasOverrides} onClick={() => void restore()}>
              <RotateCcw /> Restaurar leitura
            </button>
            <button className="is-primary" type="button" disabled={saving} onClick={() => void save()}>
              {saving ? <LoaderCircle className="is-spinning" /> : <Pencil />}
              {saving ? 'Salvando…' : 'Salvar ajustes'}
            </button>
          </div>
        </>
      )}

      <AdminImportDuplicateCheckPanel job={job} onJobUpdated={onJobUpdated} />

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}
      {!mustReview && compact && !editing && uncertain > 0 && (
        <small className="admin-import-metadata-card__optional-hint">Campos opcionais podem ser ajustados em “Alterar”.</small>
      )}
    </article>
  );
}

export function AdminImportMetadataPreviewPanel({
  jobs,
  onJobUpdated,
  onRefresh,
  compact = false
}: AdminImportMetadataPreviewPanelProps) {
  const [workingJobId, setWorkingJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const eligible = jobs.filter(job => job.status === 'pending' && job.mediaDecision);
  const waiting = eligible.filter(job => !job.metadataPreview);
  const ready = eligible.filter(job => job.metadataPreview);

  const extract = async (job: ImportJob) => {
    if (workingJobId) return;
    setWorkingJobId(job.id);
    setError(null);
    try {
      const result = await extractAdminImportMetadata(job.id);
      onJobUpdated(result.job);
    } catch (caught) {
      await onRefresh().catch(() => undefined);
      setError(caught instanceof Error ? caught.message : 'Não foi possível gerar o preview de metadata.');
    } finally {
      setWorkingJobId(null);
    }
  };

  if (compact && ready.length === 0 && waiting.length === 0) return null;

  return (
    <section className={`admin-import-metadata${compact ? ' is-compact' : ''}`} aria-labelledby="admin-import-metadata-title">
      {!compact && (
        <div className="admin-import-metadata__heading">
          <div>
            <span className="my-account-link-group__label">Preview</span>
            <strong id="admin-import-metadata-title">Revisar metadata antes de importar</strong>
            <small>Confira as informações e ajuste somente se necessário.</small>
          </div>
          <span className="admin-import-metadata__counter">
            <CheckCircle2 /> {ready.length} pronta{ready.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {waiting.length > 0 && (
        <div className="admin-import-metadata__waiting">
          <div className="admin-import-validation__queue-heading">
            <strong>{compact ? 'Preparando prévia…' : 'Aguardando preview'}</strong>
            <small>{compact ? 'Lendo metadata e capa automaticamente.' : `${waiting.length} arquivo validado`}</small>
          </div>
          {!compact && (
            <div className="admin-import-validation__jobs">
              {waiting.map(job => {
                const working = workingJobId === job.id;
                return (
                  <article className="admin-import-validation-job" key={job.id}>
                    <div>
                      <strong>{job.label}</strong>
                      <small>Metadata local primeiro · provider apenas como sugestão</small>
                    </div>
                    <button type="button" disabled={Boolean(workingJobId)} onClick={() => void extract(job)}>
                      {working ? <LoaderCircle className="is-spinning" /> : <Music2 />}
                      {working ? 'Lendo…' : 'Gerar preview'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!compact && ready.length === 0 && waiting.length === 0 && (
        <div className="admin-import-validation__empty">
          <Music2 />
          <span>Valide uma mídia para liberar o preview de metadata.</span>
        </div>
      )}

      {ready.length > 0 && (
        <div className="admin-import-metadata__cards">
          {ready.map(job => (
            <MetadataPreviewCard
              key={`${job.id}:${job.metadataPreview!.generatedAt}`}
              job={job}
              onJobUpdated={onJobUpdated}
              compact={compact}
            />
          ))}
        </div>
      )}

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}
    </section>
  );
}
