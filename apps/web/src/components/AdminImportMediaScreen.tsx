import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { ImportJob, ImportJobStatus } from '@home-music/shared';
import {
  Ban,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock3,
  FileAudio,
  FileUp,
  Link2,
  LoaderCircle,
  RefreshCw,
  UploadCloud,
  X
} from 'lucide-react';
import {
  cancelAdminImportUpload,
  cancelAdminImportUrl,
  createAdminImportUpload,
  createAdminImportUrl,
  getAdminImportJobs,
  uploadAdminImportFile,
  type AdminImportMediaValidationConfig,
  type AdminImportUploadConfig,
  type AdminImportUrlConfig
} from '../admin-import-client';
import { AdminExternalProviderPanel } from './AdminExternalProviderPanel';
import {
  AdminImportMediaDecisionSummary,
  AdminImportMediaValidationPanel
} from './AdminImportMediaValidationPanel';
import {
  AdminImportMetadataPreviewPanel,
  AdminImportMetadataSummary
} from './AdminImportMetadataPreviewPanel';

type AdminImportMediaScreenProps = {
  onBack: () => void;
};

type UploadStage = 'preparing' | 'uploading' | 'cancelling' | 'queued' | 'cancelled' | 'error';
type SourceMode = 'provider' | 'local';

type ActiveUpload = {
  jobId: string | null;
  fileName: string;
  size: number;
  loaded: number;
  stage: UploadStage;
  error: string | null;
};

const STATUS_LABELS: Record<ImportJobStatus, string> = {
  pending: 'Pendente',
  processing: 'Processando',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
};

const UPLOAD_STAGE_LABELS: Record<UploadStage, string> = {
  preparing: 'Preparando',
  uploading: 'Enviando arquivo',
  cancelling: 'Cancelando',
  queued: 'Preparando automaticamente',
  cancelled: 'Cancelado',
  error: 'Falhou'
};

function statusIcon(status: ImportJobStatus) {
  switch (status) {
    case 'processing': return <LoaderCircle className="is-spinning" />;
    case 'completed': return <CheckCircle2 />;
    case 'failed': return <CircleAlert />;
    case 'cancelled': return <Ban />;
    case 'pending': return <Clock3 />;
  }
}

function sourceLabel(job: ImportJob) {
  if (job.source.type === 'provider') return 'YouTube / YouTube Music';
  if (job.source.type === 'url') return 'URL direta';
  return 'Arquivo local';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function extensionOf(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function validateRemoteUrl(value: string, config: AdminImportUrlConfig | null) {
  const trimmed = value.trim();
  if (!trimmed) return 'Informe uma URL direta para o arquivo de áudio.';
  try {
    const parsed = new URL(trimmed);
    const protocols = config?.acceptedProtocols ?? ['http:', 'https:'];
    if (!protocols.includes(parsed.protocol)) return 'Use uma URL HTTP ou HTTPS.';
  } catch {
    return 'Informe uma URL válida.';
  }
  return null;
}

export function AdminImportMediaScreen({ onBack }: AdminImportMediaScreenProps) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [sourceMode, setSourceMode] = useState<SourceMode>('provider');
  const [uploadConfig, setUploadConfig] = useState<AdminImportUploadConfig | null>(null);
  const [urlConfig, setUrlConfig] = useState<AdminImportUrlConfig | null>(null);
  const [mediaValidationConfig, setMediaValidationConfig] = useState<AdminImportMediaValidationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [activeUpload, setActiveUpload] = useState<ActiveUpload | null>(null);
  const [dragging, setDragging] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [activeUrlJobId, setActiveUrlJobId] = useState<string | null>(null);
  const [urlSubmitting, setUrlSubmitting] = useState(false);
  const [urlCancelling, setUrlCancelling] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const currentXhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelRequestedRef = useRef(false);

  const loadJobs = useCallback(async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await getAdminImportJobs();
      setJobs(response.jobs);
      setUploadConfig(response.upload);
      setUrlConfig(response.url);
      setMediaValidationConfig(response.mediaValidation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar as importações.');
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const activeUrlJob = activeUrlJobId ? jobs.find(job => job.id === activeUrlJobId) ?? null : null;
  const urlBusy = urlSubmitting || urlCancelling || activeUrlJob?.status === 'processing';
  const pipelineBusy = jobs.some(job =>
    job.status === 'processing'
    || (job.status === 'pending' && (!job.mediaDecision || !job.metadataPreview))
  );

  useEffect(() => {
    if (!pipelineBusy) return;
    const timer = window.setInterval(() => { void loadJobs(true); }, 900);
    return () => window.clearInterval(timer);
  }, [loadJobs, pipelineBusy]);

  const handleUpdatedJob = useCallback((job: ImportJob) => {
    setJobs(current => {
      const exists = current.some(item => item.id === job.id);
      return exists
        ? current.map(item => item.id === job.id ? job : item)
        : [job, ...current];
    });
  }, []);

  const beginUpload = useCallback(async (file: File) => {
    if (!uploadConfig) {
      setUploadError('Configuração de upload ainda não carregada.');
      return;
    }
    if (activeUpload && ['preparing', 'uploading', 'cancelling'].includes(activeUpload.stage)) {
      setUploadError('Aguarde o envio atual terminar ou cancele antes de enviar outro arquivo.');
      return;
    }
    if (file.size <= 0) {
      setUploadError('O arquivo selecionado está vazio.');
      return;
    }
    if (file.size > uploadConfig.maxBytes) {
      setUploadError(`O arquivo excede o limite de ${formatBytes(uploadConfig.maxBytes)}.`);
      return;
    }
    if (!uploadConfig.acceptedExtensions.includes(extensionOf(file.name))) {
      setUploadError(`Formato não suportado. Use ${uploadConfig.acceptedExtensions.join(', ')}.`);
      return;
    }

    setUploadError(null);
    cancelRequestedRef.current = false;
    setActiveUpload({ jobId: null, fileName: file.name, size: file.size, loaded: 0, stage: 'preparing', error: null });

    let createdJobId: string | null = null;
    try {
      const job = await createAdminImportUpload(file);
      createdJobId = job.id;
      if (cancelRequestedRef.current) return;
      setActiveUpload(current => current ? { ...current, jobId: job.id, stage: 'uploading' } : current);
      const transfer = uploadAdminImportFile(job.id, file, loaded => {
        setActiveUpload(current => current?.jobId === job.id ? { ...current, loaded } : current);
      });
      currentXhrRef.current = transfer.xhr;
      await transfer.promise;
      if (cancelRequestedRef.current) return;
      setActiveUpload(current => current?.jobId === job.id
        ? { ...current, loaded: file.size, stage: 'queued', error: null }
        : current);
      await loadJobs(true);
    } catch (caught) {
      if (cancelRequestedRef.current) return;
      if (createdJobId) {
        await cancelAdminImportUpload(createdJobId).catch(() => undefined);
        await loadJobs(true);
      }
      const message = caught instanceof Error ? caught.message : 'Não foi possível enviar o arquivo.';
      setActiveUpload(current => current ? { ...current, stage: 'error', error: message } : current);
    } finally {
      currentXhrRef.current = null;
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [activeUpload, loadJobs, uploadConfig]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const selected = Array.from(files);
    if (selected.length !== 1) {
      setUploadError('Envie um arquivo por vez.');
      return;
    }
    void beginUpload(selected[0]);
  }, [beginUpload]);

  const cancelUpload = useCallback(async () => {
    const jobId = activeUpload?.jobId;
    if (!jobId || !['uploading', 'queued'].includes(activeUpload.stage)) return;
    cancelRequestedRef.current = true;
    setActiveUpload(current => current ? { ...current, stage: 'cancelling', error: null } : current);
    try {
      await cancelAdminImportUpload(jobId);
      currentXhrRef.current?.abort();
      setActiveUpload(current => current?.jobId === jobId ? { ...current, stage: 'cancelled', error: null } : current);
      await loadJobs(true);
    } catch (caught) {
      cancelRequestedRef.current = false;
      const message = caught instanceof Error ? caught.message : 'Não foi possível cancelar o upload.';
      setActiveUpload(current => current?.jobId === jobId ? { ...current, stage: 'error', error: message } : current);
    }
  }, [activeUpload, loadJobs]);

  const submitUrl = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateRemoteUrl(urlValue, urlConfig);
    if (validationError) {
      setUrlError(validationError);
      return;
    }

    setUrlError(null);
    setUrlSubmitting(true);
    try {
      const job = await createAdminImportUrl(urlValue.trim());
      setActiveUrlJobId(job.id);
      setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setUrlValue('');
    } catch (caught) {
      setUrlError(caught instanceof Error ? caught.message : 'Não foi possível iniciar a importação por URL.');
    } finally {
      setUrlSubmitting(false);
    }
  }, [urlConfig, urlValue]);

  const cancelUrl = useCallback(async () => {
    if (!activeUrlJobId || !activeUrlJob || !['processing', 'pending'].includes(activeUrlJob.status)) return;
    setUrlError(null);
    setUrlCancelling(true);
    try {
      const job = await cancelAdminImportUrl(activeUrlJobId);
      handleUpdatedJob(job);
    } catch (caught) {
      setUrlError(caught instanceof Error ? caught.message : 'Não foi possível cancelar a importação por URL.');
    } finally {
      setUrlCancelling(false);
    }
  }, [activeUrlJob, activeUrlJobId, handleUpdatedJob]);

  const uploadPercent = activeUpload?.size
    ? Math.min(100, Math.round((activeUpload.loaded / activeUpload.size) * 100))
    : 0;
  const uploadBusy = Boolean(activeUpload && ['preparing', 'uploading', 'cancelling'].includes(activeUpload.stage));
  const accept = uploadConfig?.acceptedExtensions.join(',') || undefined;
  const preparedJob = jobs.find(job => job.status === 'pending' && job.mediaDecision) ?? null;
  const newestJob = jobs[0] ?? null;

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (uploadBusy) return;
    handleFiles(event.dataTransfer.files);
  };

  return (
    <section className="my-account-screen admin-import-screen admin-import-screen--focused" aria-labelledby="admin-import-title">
      <header className="my-account-header admin-import-focused-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-import-title">Importar mídia</strong>
          <small>Adicione músicas à sua biblioteca</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-import-workbench">
        <div className="admin-import-source-tabs" role="tablist" aria-label="Origem da música">
          <button
            type="button"
            role="tab"
            aria-selected={sourceMode === 'provider'}
            className={sourceMode === 'provider' ? 'is-active' : ''}
            onClick={() => setSourceMode('provider')}
          >
            <Boxes />
            <span><strong>Link do YouTube / YouTube Music</strong><small>Importe a partir de um link</small></span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceMode === 'local'}
            className={sourceMode === 'local' ? 'is-active' : ''}
            onClick={() => setSourceMode('local')}
          >
            <FileAudio />
            <span><strong>Arquivo local ou URL direta</strong><small>Importe outras fontes de áudio</small></span>
          </button>
        </div>

        <div className="admin-import-source-panel">
          {sourceMode === 'provider' ? (
            <AdminExternalProviderPanel
              compact
              jobs={jobs}
              onJobUpdated={handleUpdatedJob}
              onRefresh={() => loadJobs(true)}
            />
          ) : (
            <div className="admin-import-local-sources">
              <section className="admin-import-upload is-compact" aria-labelledby="admin-import-upload-title">
                <div className="admin-import-upload__heading">
                  <div><strong id="admin-import-upload-title">Arquivo local</strong><small>Arraste ou selecione uma música</small></div>
                  {uploadConfig && <small>Até {formatBytes(uploadConfig.maxBytes)}</small>}
                </div>
                <div
                  className={`admin-import-dropzone is-compact${dragging ? ' is-dragging' : ''}${uploadBusy ? ' is-disabled' : ''}`}
                  onDragEnter={event => { event.preventDefault(); if (!uploadBusy) setDragging(true); }}
                  onDragOver={event => event.preventDefault()}
                  onDragLeave={event => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }}
                  onDrop={onDrop}
                >
                  <UploadCloud />
                  <div><strong>Arraste uma música para cá</strong><small>ou selecione um arquivo do dispositivo</small></div>
                  <button type="button" disabled={uploadBusy || !uploadConfig} onClick={() => inputRef.current?.click()}>Selecionar arquivo</button>
                  <input
                    ref={inputRef}
                    className="admin-import-file-input"
                    type="file"
                    accept={accept}
                    aria-label="Selecionar arquivo de áudio"
                    disabled={uploadBusy || !uploadConfig}
                    onChange={event => event.target.files && handleFiles(event.target.files)}
                  />
                </div>
                {uploadError && <div className="my-account-message is-error admin-import-message" role="alert">{uploadError}</div>}
                {activeUpload && (
                  <article className={`admin-import-upload-status is-${activeUpload.stage}`} aria-live="polite">
                    <div className="admin-import-upload-status__top">
                      <div><strong>{activeUpload.fileName}</strong><small>{UPLOAD_STAGE_LABELS[activeUpload.stage]}</small></div>
                      {(activeUpload.stage === 'uploading' || activeUpload.stage === 'queued') && (
                        <button type="button" onClick={() => void cancelUpload()}><X /> Cancelar</button>
                      )}
                    </div>
                    {(activeUpload.stage === 'uploading' || activeUpload.stage === 'preparing') && (
                      <div className="admin-import-progress-row"><progress max={100} value={uploadPercent} /><strong>{uploadPercent}%</strong></div>
                    )}
                    {activeUpload.error && <small className="admin-import-job__error">{activeUpload.error}</small>}
                  </article>
                )}
              </section>

              <section className="admin-import-url is-compact" aria-labelledby="admin-import-url-title">
                <div className="admin-import-upload__heading">
                  <div><strong id="admin-import-url-title">URL direta</strong><small>Link direto para um arquivo de áudio</small></div>
                  <Link2 />
                </div>
                <form className="admin-import-url__form" onSubmit={event => void submitUrl(event)}>
                  <div className="admin-import-url__input-row">
                    <input
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      aria-label="URL direta do arquivo"
                      placeholder="https://exemplo.com/musica.flac"
                      value={urlValue}
                      disabled={urlBusy || !urlConfig}
                      onChange={event => { setUrlValue(event.target.value); if (urlError) setUrlError(null); }}
                    />
                    <button type="submit" disabled={urlBusy || !urlConfig || !urlValue.trim()}>
                      {urlSubmitting ? <LoaderCircle className="is-spinning" /> : <Link2 />} Analisar URL
                    </button>
                  </div>
                </form>
                {urlError && <div className="my-account-message is-error admin-import-message" role="alert">{urlError}</div>}
                {activeUrlJob && ['processing', 'failed', 'cancelled'].includes(activeUrlJob.status) && (
                  <article className={`admin-import-url-status is-${activeUrlJob.status}`}>
                    <span className="admin-import-job__status">{statusIcon(activeUrlJob.status)}</span>
                    <div><strong>{activeUrlJob.label}</strong><small>{activeUrlJob.error || STATUS_LABELS[activeUrlJob.status]}</small></div>
                    {activeUrlJob.status === 'processing' && <button type="button" disabled={urlCancelling} onClick={() => void cancelUrl()}><X /> Cancelar</button>}
                  </article>
                )}
              </section>
            </div>
          )}
        </div>

        {preparedJob && (
          <div className="admin-import-review-stage">
            <div className="admin-import-review-stage__heading">
              <div><strong>Encontramos esta música</strong><small>Confira apenas o que precisar antes de salvar.</small></div>
              <CheckCircle2 />
            </div>
            <AdminImportMetadataPreviewPanel
              compact
              jobs={[preparedJob]}
              onJobUpdated={handleUpdatedJob}
              onRefresh={() => loadJobs(true)}
            />
          </div>
        )}

        {!preparedJob && newestJob?.status === 'completed' && (
          <div className="admin-import-success" role="status">
            <CheckCircle2 />
            <div><strong>Importação concluída!</strong><small>A música foi adicionada à sua biblioteca.</small></div>
          </div>
        )}

        <small className="admin-import-workbench__privacy">O conteúdo informado é usado apenas para esta importação.</small>
      </div>

      <div className="admin-import-secondary">
        {mediaValidationConfig && (
          <details className="admin-import-details">
            <summary>Detalhes técnicos</summary>
            <AdminImportMediaValidationPanel
              jobs={preparedJob ? [preparedJob] : jobs.filter(job => !['completed', 'cancelled'].includes(job.status)).slice(0, 3)}
              config={mediaValidationConfig}
              onJobUpdated={handleUpdatedJob}
              onRefresh={() => loadJobs(true)}
            />
          </details>
        )}

        <details className="admin-import-details admin-import-history">
          <summary>
            <span>Histórico de importações</span>
            <span>{jobs.length}</span>
          </summary>
          <div className="admin-import-queue__heading">
            <small>Importações mais recentes</small>
            <button type="button" aria-label="Atualizar importações" disabled={loading || refreshing} onClick={() => void loadJobs(true)}>
              <RefreshCw className={refreshing ? 'is-spinning' : ''} />
            </button>
          </div>
          {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}
          {loading ? (
            <div className="admin-import-empty"><LoaderCircle className="is-spinning" /> Carregando…</div>
          ) : jobs.length === 0 ? (
            <div className="admin-import-empty"><Clock3 /><span>Nenhuma importação ainda.</span></div>
          ) : (
            <div className="admin-import-job-list">
              {jobs.slice(0, 8).map(job => (
                <article className={`admin-import-job is-${job.status}`} key={job.id}>
                  <span className="admin-import-job__status">{statusIcon(job.status)}</span>
                  <div className="admin-import-job__body">
                    <strong>{job.metadataPreview?.effective.title || job.label}</strong>
                    <small>{sourceLabel(job)} · {formatDate(job.createdAt)}</small>
                    <AdminImportMediaDecisionSummary job={job} />
                    <AdminImportMetadataSummary job={job} />
                    {job.error && <small className="admin-import-job__error">{job.error}</small>}
                  </div>
                  <span className="admin-import-job__badge">{STATUS_LABELS[job.status]}</span>
                </article>
              ))}
            </div>
          )}
        </details>
      </div>
    </section>
  );
}
