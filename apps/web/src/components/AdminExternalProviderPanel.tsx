import { useEffect, useState, type FormEvent } from 'react';
import type { ImportJob } from '@home-music/shared';
import { Boxes, CircleAlert, LoaderCircle, ShieldCheck, X } from 'lucide-react';
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
};

function validHttpUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AdminExternalProviderPanel({
  jobs,
  onJobUpdated,
  onRefresh
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

  useEffect(() => {
    if (!activeJobId || activeJob?.status !== 'processing') return;
    const timer = window.setInterval(() => { void onRefresh(); }, 1000);
    return () => window.clearInterval(timer);
  }, [activeJob?.status, activeJobId, onRefresh]);

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
      setError(error instanceof Error ? error.message : 'Não foi possível iniciar o provider externo.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!activeJobId) return;
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
    <section className="admin-import-provider" aria-labelledby="admin-import-provider-title">
      <div className="admin-import-upload__heading">
        <div>
          <span className="my-account-link-group__label">Fontes externas</span>
          <strong id="admin-import-provider-title">YouTube Music e sites compatíveis</strong>
        </div>
        <small>{!providersLoaded ? 'Verificando…' : available.length > 0 ? `${available.length} disponível` : 'yt-dlp não encontrado'}</small>
      </div>

      {providersLoaded && available.length === 0 ? (
        <div className="admin-import-provider__unavailable">
          <CircleAlert />
          <div>
            <strong>yt-dlp não está disponível no servidor</strong>
            <small>
              Instale o yt-dlp em /usr/local/bin, /usr/bin ou ~/.local/bin; para outro caminho, configure HOME_MUSIC_YT_DLP_PATH.
            </small>
          </div>
        </div>
      ) : available.length > 0 ? (
        <form className="admin-import-provider__form" onSubmit={event => void submit(event)}>
          <div className="admin-import-provider__fields">
            <label>
              <span>Provider</span>
              <select
                value={providerId}
                disabled={submitting || Boolean(activeJob?.status === 'processing')}
                onChange={event => setProviderId(event.target.value)}
              >
                {available.map(provider => <option value={provider.id} key={provider.id}>{provider.label}</option>)}
              </select>
            </label>
            <label className="admin-import-provider__url">
              <span>Link do conteúdo</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://music.youtube.com/watch?v=..."
                value={url}
                disabled={submitting || Boolean(activeJob?.status === 'processing')}
                onChange={event => { setUrl(event.target.value); if (error) setError(null); }}
              />
            </label>
            <button type="submit" disabled={submitting || !providerId || !url.trim() || activeJob?.status === 'processing'}>
              {submitting ? <LoaderCircle className="is-spinning" /> : <Boxes />}
              Importar
            </button>
          </div>
          <small className="admin-import-provider__policy">
            <ShieldCheck /> Links do YouTube e YouTube Music devem ser colados aqui, não em “URL direta”. Use apenas conteúdo que você tenha direito de baixar.
          </small>
        </form>
      ) : (
        <div className="admin-import-empty"><LoaderCircle className="is-spinning" /> Verificando providers…</div>
      )}

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}

      {activeJob && (
        <article className={`admin-import-url-status is-${activeJob.status}`} aria-live="polite">
          <span className="admin-import-job__status">
            {activeJob.status === 'processing' ? <LoaderCircle className="is-spinning" /> : <Boxes />}
          </span>
          <div>
            <strong>{activeJob.label}</strong>
            <small>{activeJob.status === 'processing'
              ? 'Adquirindo a melhor fonte de áudio pelo proxy de egress isolado.'
              : activeJob.status === 'pending'
                ? 'Mídia recebida no staging. Aguardando validação técnica.'
                : activeJob.error || 'Operação encerrada.'}</small>
          </div>
          {['processing', 'pending'].includes(activeJob.status) && (
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
