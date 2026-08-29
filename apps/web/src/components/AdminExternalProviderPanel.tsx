import { useEffect, useState, type FormEvent } from 'react';
import type { ImportJob } from '@home-music/shared';
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Folder,
  Link2,
  ListMusic,
  LoaderCircle,
  Plus,
  ShieldCheck,
  X
} from 'lucide-react';
import {
  cancelAdminExternalProvider,
  cancelAdminExternalProviderBatch,
  getAdminExternalProviderBatch,
  getAdminExternalProviders,
  inspectAdminExternalProviderBatch,
  startAdminExternalProvider,
  startAdminExternalProviderBatch,
  type AdminExternalProviderBatch,
  type AdminExternalProviderDescriptor
} from '../admin-external-provider-client';
import {
  getAdminImportDestinationFolders,
  type AdminImportDestinationFolder
} from '../admin-import-destination-client';
import '../admin-external-provider-batch.css';

type AdminExternalProviderPanelProps = {
  jobs: ImportJob[];
  onJobUpdated: (job: ImportJob) => void;
  onRefresh: () => Promise<unknown> | unknown;
  compact?: boolean;
};

const TERMINAL_STATUSES = new Set<ImportJob['status']>(['completed', 'failed', 'cancelled']);
const TERMINAL_BATCH_STATUSES = new Set<AdminExternalProviderBatch['status']>(['completed', 'failed', 'cancelled']);

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
      : 'Baixando a melhor qualidade de áudio disponível…';
  }
  if (job.metadataPreview) {
    return 'Prévia pronta. Confira as informações e escolha o destino.';
  }
  if (job.mediaDecision) return 'Preparando metadata e verificação de duplicatas…';
  return 'Mídia recebida. As verificações automáticas vão começar.';
}

function formatDuration(seconds: number | null) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${Math.max(1, minutes)} min`;
}

function batchDuration(batch: AdminExternalProviderBatch) {
  const known = batch.items.reduce((total, item) => total + (item.durationSeconds ?? 0), 0);
  return formatDuration(known);
}

function batchStatusLabel(batch: AdminExternalProviderBatch) {
  if (batch.status === 'ready') return 'Playlist pronta para importar';
  if (batch.status === 'running') return 'Importando playlist…';
  if (batch.status === 'cancelling') return 'Cancelando playlist…';
  if (batch.status === 'cancelled') return 'Playlist cancelada';
  if (batch.status === 'failed') return 'Playlist encerrada com falha';
  return 'Importação da playlist concluída';
}

function batchItemStatusLabel(status: AdminExternalProviderBatch['items'][number]['status']) {
  switch (status) {
    case 'queued': return 'Na fila';
    case 'processing': return 'Importando';
    case 'completed': return 'Concluída';
    case 'duplicate': return 'Duplicada';
    case 'ignored': return 'Ignorada';
    case 'failed': return 'Falhou';
    case 'cancelled': return 'Cancelada';
  }
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
  const [activeBatch, setActiveBatch] = useState<AdminExternalProviderBatch | null>(null);
  const [folders, setFolders] = useState<AdminImportDestinationFolder[]>([]);
  const [folderPath, setFolderPath] = useState('Importados');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startingBatch, setStartingBatch] = useState(false);
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
  const batchRunning = Boolean(activeBatch && !TERMINAL_BATCH_STATUSES.has(activeBatch.status) && activeBatch.status !== 'ready');
  const canCancelAcquisition = acquisitionRunning;

  useEffect(() => {
    if (!activeJobId || !activeJobRunning) return;
    const timer = window.setInterval(() => { void onRefresh(); }, 900);
    return () => window.clearInterval(timer);
  }, [activeJobId, activeJobRunning, onRefresh]);

  useEffect(() => {
    if (!activeBatch || !batchRunning) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await getAdminExternalProviderBatch(activeBatch.id);
        if (!active) return;
        setActiveBatch(next);
        await onRefresh();
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Não foi possível atualizar o progresso da playlist.');
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 900);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [activeBatch?.id, batchRunning, onRefresh]);

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
    setActiveBatch(null);
    try {
      const sourceUrl = url.trim();
      const inspected = await inspectAdminExternalProviderBatch(providerId, sourceUrl);
      if (inspected.batch) {
        const [availableFolders] = await Promise.all([
          getAdminImportDestinationFolders().catch(() => [] as AdminImportDestinationFolder[]),
          onRefresh()
        ]);
        setFolders(availableFolders);
        setFolderPath('Importados');
        setCreatingFolder(false);
        setNewFolderPath('');
        setActiveJobId(null);
        setActiveBatch(inspected.batch);
        setUrl('');
        return;
      }

      const job = await startAdminExternalProvider(providerId, sourceUrl);
      setActiveJobId(job.id);
      onJobUpdated(job);
      setUrl('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível analisar esse link.');
    } finally {
      setSubmitting(false);
    }
  };

  const startBatch = async () => {
    if (!activeBatch || activeBatch.status !== 'ready' || startingBatch) return;
    const destination = creatingFolder ? newFolderPath.trim() : folderPath;
    if (creatingFolder && !destination) {
      setError('Informe o nome da nova pasta.');
      return;
    }
    setStartingBatch(true);
    setError(null);
    try {
      const next = await startAdminExternalProviderBatch(activeBatch.id, destination);
      setActiveBatch(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível iniciar a playlist.');
    } finally {
      setStartingBatch(false);
    }
  };

  const cancel = async () => {
    if (activeBatch && (activeBatch.status === 'ready' || batchRunning)) {
      setCancelling(true);
      setError(null);
      try {
        const next = await cancelAdminExternalProviderBatch(activeBatch.id);
        setActiveBatch(next);
        await onRefresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Não foi possível cancelar a playlist.');
      } finally {
        setCancelling(false);
      }
      return;
    }

    if (!activeJobId || !canCancelAcquisition) return;
    setCancelling(true);
    setError(null);
    try {
      const job = await cancelAdminExternalProvider(activeJobId);
      onJobUpdated(job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível cancelar o provider externo.');
    } finally {
      setCancelling(false);
    }
  };

  const selectedFolder = folders.find(folder => folder.path === folderPath) ?? null;
  const batchProgress = activeBatch?.summary.total
    ? Math.round((activeBatch.summary.processed / activeBatch.summary.total) * 100)
    : 0;
  const batchOpen = Boolean(activeBatch && !TERMINAL_BATCH_STATUSES.has(activeBatch.status));
  const formBusy = submitting || activeJobRunning || batchOpen || startingBatch;

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
                <small>Faixa individual ou playlist do YouTube / YouTube Music</small>
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
                  disabled={formBusy}
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
                disabled={formBusy}
                onChange={event => { setUrl(event.target.value); if (error) setError(null); }}
              />
            </label>
            <button className={compact ? 'is-primary' : undefined} type="submit" disabled={formBusy || !providerId || !url.trim()}>
              {submitting || pipelineRunning ? <LoaderCircle className="is-spinning" /> : compact ? <Link2 /> : <Boxes />}
              {submitting ? 'Analisando…' : compact ? 'Analisar link' : 'Importar'}
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

      {activeBatch && (
        <article className={`admin-provider-batch is-${activeBatch.status}`} aria-live="polite">
          <div className="admin-provider-batch__heading">
            <span className="admin-provider-batch__icon">
              {batchRunning ? <LoaderCircle className="is-spinning" /> : activeBatch.status === 'completed' ? <CheckCircle2 /> : <ListMusic />}
            </span>
            <div>
              <strong>{activeBatch.label}</strong>
              <small>
                {activeBatch.summary.total} {activeBatch.summary.total === 1 ? 'música' : 'músicas'}
                {batchDuration(activeBatch) ? ` · ${batchDuration(activeBatch)}` : ''}
                {' · melhor qualidade disponível'}
              </small>
            </div>
            <span className="admin-provider-batch__status">{batchStatusLabel(activeBatch)}</span>
          </div>

          {activeBatch.status === 'ready' && (
            <div className="admin-provider-batch__destination">
              <div className="admin-provider-batch__folder-row">
                <Folder />
                <div>
                  <strong>Salvar playlist em</strong>
                  <small>Todos os itens usam o mesmo destino, com nomes sem colisão.</small>
                </div>
              </div>

              {!creatingFolder ? (
                <div className="admin-provider-batch__folder-picker">
                  <div className="admin-import-destination__select-wrap">
                    <select
                      aria-label="Pasta de destino da playlist"
                      value={folderPath}
                      disabled={startingBatch}
                      onChange={event => setFolderPath(event.target.value)}
                    >
                      {!folders.some(folder => folder.path === 'Importados') && <option value="Importados">Importados</option>}
                      {folders.map(folder => <option value={folder.path} key={folder.path}>{folder.path}</option>)}
                    </select>
                    <ChevronDown aria-hidden="true" />
                  </div>
                  <small>{selectedFolder ? `${selectedFolder.trackCount} músicas atuais` : 'Pasta padrão'}</small>
                  <button type="button" onClick={() => { setCreatingFolder(true); setNewFolderPath(''); setError(null); }}>
                    <Plus /> Nova pasta
                  </button>
                </div>
              ) : (
                <div className="admin-provider-batch__new-folder">
                  <input
                    aria-label="Nova pasta para a playlist"
                    type="text"
                    maxLength={1024}
                    value={newFolderPath}
                    placeholder="Ex.: Playlists/Jota Quest"
                    disabled={startingBatch}
                    autoFocus
                    onChange={event => { setNewFolderPath(event.target.value); if (error) setError(null); }}
                  />
                  <button type="button" onClick={() => setCreatingFolder(false)}>Usar existente</button>
                </div>
              )}

              <div className="admin-provider-batch__actions">
                <button type="button" disabled={cancelling || startingBatch} onClick={() => void cancel()}>
                  <X /> Cancelar
                </button>
                <button className="is-primary" type="button" disabled={startingBatch || (creatingFolder && !newFolderPath.trim())} onClick={() => void startBatch()}>
                  {startingBatch ? <LoaderCircle className="is-spinning" /> : <ListMusic />}
                  {startingBatch ? 'Iniciando…' : `Importar ${activeBatch.summary.total} músicas`}
                </button>
              </div>
            </div>
          )}

          {(batchRunning || TERMINAL_BATCH_STATUSES.has(activeBatch.status)) && (
            <div className="admin-provider-batch__progress">
              <div>
                <span>Progresso</span>
                <strong>{activeBatch.summary.processed}/{activeBatch.summary.total}</strong>
              </div>
              <progress max={100} value={batchProgress}>{batchProgress}%</progress>
              <small>
                {activeBatch.summary.completed} concluídas · {activeBatch.summary.duplicates} duplicadas · {activeBatch.summary.ignored} ignoradas · {activeBatch.summary.failed} falhas
              </small>
              {batchRunning && (
                <button type="button" disabled={cancelling} onClick={() => void cancel()}>
                  {cancelling ? <LoaderCircle className="is-spinning" /> : <X />}
                  Cancelar lote
                </button>
              )}
            </div>
          )}

          <details className="admin-provider-batch__items">
            <summary>Ver itens <span>{activeBatch.summary.total}</span></summary>
            <div>
              {activeBatch.items.map(item => (
                <div className={`admin-provider-batch__item is-${item.status}`} key={`${activeBatch.id}:${item.index}`}>
                  <span>{item.index + 1}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.destination || item.error || batchItemStatusLabel(item.status)}</small>
                  </div>
                  <small>{batchItemStatusLabel(item.status)}</small>
                </div>
              ))}
            </div>
          </details>
        </article>
      )}

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}

      {activeJob && !activeBatch && (
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
