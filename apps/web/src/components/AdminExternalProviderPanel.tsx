import { useEffect, useState, type FormEvent } from 'react';
import type { ImportJob } from '@home-music/shared';
import { Boxes, CircleAlert, Link2, LoaderCircle, ShieldCheck, X } from 'lucide-react';
import {
  cancelAdminExternalProvider,
  getAdminExternalProviders,
  startAdminExternalProvider,
  type AdminExternalProviderDescriptor
} from '../admin-external-provider-client';

type AdminExternalProviderPanelProps = {
  jobs: ImportJob[];
  onJobUpdated: (job: ImportJob) => void;
  onRefresh: () => Promise<unknown> | unknown;
  compact?: boolean;
};

const TERMINAL_STATUSES = new Set<ImportJob['status']>(['completed', 'failed', 'cancelled']);

function validHttpUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function activeJobMessage(job: ImportJob) {
  if (job.status === 'completed') return 'Importação concluída e adicionada à biblioteca.';
  if (job.status === 'failed' || job.status === 'cancelled') return job.error || 'Operação encerrada.';
  if (job.status === 'processing') {
    return job.mediaDecision
      ? 'Validando a mídia automaticamente.'
      : 'Baixando a melhor fonte de áudio…';
  }
  if (job.metadataPreview) {
    return 'Prévia pronta. Confira as informações e escolha o destino.';
  }
  if (job.mediaDecision) return 'Preparando metadata e verificação de duplicatas…';
  return 'Mídia recebida. As verificações automáticas vão começar.';
}

export function AdminExternalProviderPanel({
  jobs,
  onJobUpdated,
  onRefresh,
  compact = false
}: AdminExternalProviderPanelProps) {
  const [providers, setProviders] = useState<AdminExternalProviderDescriptor[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const available = providers.filter(provider => provider.configured && provider.capabilities.audio);
  const [providerId, setProviderId] = useState('');
  const [url, setUrl] = useState('');
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminExternalProviders()
      .then(items => { if (active) setProviders(items); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Não foi possível carregar os providers.'); })
      .finally(() => { if (active) setProvidersLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (providerId && available.some(provider => provider.id === providerId)) return;
    setProviderId(available[0]?.id ?? '');
  }, [available, providerId]);

  const activeJob = activeJobId ? jobs.find(job => job.id === activeJobId) ?? null : null;
  const acquisitionRunning = Boolean(activeJob?.status === 'processing' && !activeJob.mediaDecision);
  const pipelineRunning = Boolean(activeJob?.status === 'processing');
  const activeJobRunning = Boolean(activeJob && !TERMINAL_STATUSES.has(activeJob.status) && !activeJob.metadataPreview);
  const canCancelAcquisition = acquisitionRunning;

  useEffect(() => {
    if (!activeJobId || !activeJobRunning) return;
    const timer = window.setInterval(() => { void onRefresh(); }, 900);
    return () => window.clearInterval(timer);
  }, [activeJobId, activeJobRunning, onRefresh]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!providerId) {
      setError('Nenhum provider externo está configurado.');
      return;
    }
    if (!validHttpUrl(url)) {
      setError('Informe uma URL HTTP ou HTTPS válida.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const job = await startAdminExternalProvider(providerId, url.trim());
      setActiveJobId(job.id);
      onJobUpdated(job);
      setUrl('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível analisar esse link.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!activeJobId || !canCancelAcquisition) return;
    setCancelling(true);
    setError(null);
    try {
      const job = await cancelAdminExternalProvider(activeJobId);
      onJobUpdated(job);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível cancelar o provider externo.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section className={`admin-import-provider${compact ? ' is-compact' : ''}`} aria-labelledby="admin-import-provider-title">
      {!compact && (
        <div className="admin-import-upload__heading">
          <div>
            <span className="my-account-link-group__label">Fontes externas</span>
            <strong id="admin-import-provider-title">YouTube Music e sites compatíveis</strong>
          </div>
          <small>{!providersLoaded ? 'Verificando…' : available.length > 0 ? `${available.length} disponível` : 'yt-dlp não encontrado'}</small>
        </div>
      )}

      {providersLoaded && available.length === 0 ? (
        <div className="admin-import-provider__unavailable">
          <CircleAlert />
          <div>
            <strong>yt-dlp não está disponível no servidor</strong>
            <small>Instale o yt-dlp em /usr/local/bin, /usr/bin ou ~/.local/bin.</small>
          </div>
        </div>
      ) : available.length > 0 ? (
        <form className="admin-import-provider__form" onSubmit={event => void submit(event)}>
          {compact && (
            <div className="admin-import-provider__compact-heading">
              <div>
                <strong id="admin-import-provider-title">Cole o link</strong>
                <small>Suporta YouTube e YouTube Music</small>
              </div>
              <Link2 />
            </div>
          )}
          <div className="admin-import-provider__fields">
            {!compact && (
              <label>
                <span>Provider</span>
                <select
                  value={providerId}
                  disabled={submitting || acquisitionRunning}
                  onChange={event => setProviderId(event.target.value)}
                >
                  {available.map(provider => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
                </select>
              </label>
            )}
            <label className="admin-import-provider__url">
              {!compact && <span>Link do conteúdo</span>}
              <input
                aria-label={compact ? 'Link do YouTube ou YouTube Music' : undefined}
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://music.youtube.com/watch?v=..."
                value={url}
                disabled={submitting || acquisitionRunning}
                onChange={event => { setUrl(event.target.value); if (error) setError(null); }}
              />
            </label>
            <button className={compact ? 'is-primary' : undefined} type="submit" disabled={submitting || !providerId || !url.trim() || acquisitionRunning}>
              {submitting || pipelineRunning ? <LoaderCircle className="is-spinning" /> : compact ? <Link2 /> : <Boxes />}
              {compact ? 'Analisar link' : 'Importar'}
            </button>
          </div>
          {!compact && (
            <small className="admin-import-provider__policy">
              <ShieldCheck /> Links do YouTube e YouTube Music devem ser colados aqui, não em “URL direta”. Use apenas conteúdo que você tenha direito de baixar.
            </small>
          )}
        </form>
      ) : (
        <div className="admin-import-empty"><LoaderCircle className="is-spinning" /> Verificando providers…</div>
      )}

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}

      {activeJob && (
        <article className={`admin-import-url-status is-${activeJob.status}${compact ? ' is-compact' : ''}`} aria-live="polite">
          <span className="admin-import-job__status">
            {activeJobRunning ? <LoaderCircle className="is-spinning" /> : <Boxes />}
          </span>
          <div>
            <strong>{activeJob.status === 'pending' && activeJob.metadataPreview ? 'Link analisado' : activeJob.label}</strong>
            <small>{activeJobMessage(activeJob)}</small>
          </div>
          {canCancelAcquisition && (
            <button type="button" disabled={cancelling} onClick={() => void cancel()}>
              {cancelling ? <LoaderCircle className="is-spinning" /> : <X />}
              Cancelar
            </button>
          )}
        </article>
      )}
    </section>
  );
}
