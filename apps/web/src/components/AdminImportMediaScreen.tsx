import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { ImportJob, ImportJobStatus } from '@home-music/shared';
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock3,
  FileAudio,
  Link2,
  LoaderCircle,
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
import { AdminImportMediaValidationPanel } from './AdminImportMediaValidationPanel';
import { AdminImportMetadataPreviewPanel } from './AdminImportMetadataPreviewPanel';

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

const PIPELINE_STEPS = [
  { id: 1, label: 'Origem' },
  { id: 2, label: 'Preparação' },
  { id: 3, label: 'Revisão' },
  { id: 4, label: 'Biblioteca' }
] as const;

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
  const [sessionStarted, setSessionStarted] = useState(false);
  const [uploadConfig, setUploadConfig] = useState<AdminImportUploadConfig | null>(null);
  const [urlConfig, setUrlConfig] = useState<AdminImportUrlConfig | null>(null);
  const [mediaValidationConfig, setMediaValidationConfig] = useState<AdminImportMediaValidationConfig | null>(null);
  const [loading, setLoading] = useState(true);
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
    if (!background) setLoading(true);
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
      if (!background) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const activeUrlJob = activeUrlJobId ? jobs.find(job => job.id === activeUrlJobId) ?? null : null;
  const urlBusy = urlSubmitting || urlCancelling || activeUrlJob?.status === 'processing';
  const pipelineBusy = jobs.some(job =>
    job.status === 'processing'
    || (job.status === 'pending' && Boolean(job.mediaDecision) && !job.metadataPreview)
  );

  useEffect(() => {
    if (!pipelineBusy) return;
    const timer = window.setInterval(() => { void loadJobs(true); }, 900);
    return () => window.clearInterval(timer);
  }, [loadJobs, pipelineBusy]);

  const handleUpdatedJob = useCallback((job: ImportJob) => {
    setSessionStarted(true);
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

    setSessionStarted(true);
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

    setSessionStarted(true);
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
  const uploadPipelineActive = Boolean(activeUpload && ['preparing', 'uploading', 'cancelling', 'queued'].includes(activeUpload.stage));
  const accept = uploadConfig?.acceptedExtensions.join(',') || undefined;
  const validationJobs = jobs.filter(job => job.status === 'pending' && !job.mediaDecision);
  const reviewJobs = jobs.filter(job => job.status === 'pending' && Boolean(job.mediaDecision));
  const activeProcessingJob = jobs.find(job => job.status === 'processing') ?? null;
  const newestJob = jobs[0] ?? null;

  const currentStep = reviewJobs.length > 0
    ? 3
    : validationJobs.length > 0 || activeProcessingJob || uploadPipelineActive || urlBusy
      ? 2
      : sessionStarted && newestJob?.status === 'completed'
        ? 4
        : 1;

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (uploadBusy) return;
    handleFiles(event.dataTransfer.files);
  };

  const restart = () => {
    setSessionStarted(false);
    setActiveUpload(null);
    setActiveUrlJobId(null);
    setUrlError(null);
    setUploadError(null);
    setError(null);
    setSourceMode('provider');
  };

  return (
    <section className="my-account-screen admin-import-screen admin-import-screen--v4" aria-labelledby="admin-import-title">
      <header className="admin-import-v4__page-header">
        <button className="admin-import-v4__back" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-import-title">Importar mídia</strong>
          <small>{currentStep === 3 ? 'Revise antes de adicionar à sua biblioteca' : currentStep === 4 ? 'Música adicionada à sua biblioteca' : 'Adicione músicas à sua biblioteca'}</small>
        </div>
        <span />
      </header>

      <nav className="admin-import-v4__progress" aria-label="Etapas da importação">
        {PIPELINE_STEPS.map(step => {
          const complete = step.id < currentStep || (currentStep === 4 && step.id === 4);
          const active = step.id === currentStep && currentStep !== 4;
          return (
            <div className={complete ? 'is-complete' : active ? 'is-active' : ''} key={step.id} aria-current={active ? 'step' : undefined}>
              <span>{complete ? <CheckCircle2 /> : step.id}</span>
              <strong>{step.label}</strong>
            </div>
          );
        })}
      </nav>

      {error && <div className="my-account-message is-error admin-import-message" role="alert">{error}</div>}

      {loading ? (
        <div className="admin-import-v4__state" role="status"><LoaderCircle className="is-spinning" /> Carregando importações…</div>
      ) : currentStep === 1 ? (
        <section className="admin-import-v4__source">
          <header>
            <strong>Escolha a origem</strong>
          </header>

          <div className="admin-import-v4__source-tabs" role="tablist" aria-label="Origem da música">
            <button
              id="admin-import-provider-tab"
              type="button"
              role="tab"
              aria-controls="admin-import-source-panel"
              aria-selected={sourceMode === 'provider'}
              className={sourceMode === 'provider' ? 'is-active' : ''}
              onClick={() => setSourceMode('provider')}
            >
              <span className="admin-import-v4__source-tab-icon">▶</span>
              <strong>YouTube / YouTube Music</strong>
            </button>
            <button
              id="admin-import-local-tab"
              type="button"
              role="tab"
              aria-controls="admin-import-source-panel"
              aria-selected={sourceMode === 'local'}
              className={sourceMode === 'local' ? 'is-active' : ''}
              onClick={() => setSourceMode('local')}
            >
              <FileAudio />
              <strong>Arquivo ou URL</strong>
            </button>
          </div>

          <div
            id="admin-import-source-panel"
            className="admin-import-v4__source-panel"
            role="tabpanel"
            aria-labelledby={sourceMode === 'provider' ? 'admin-import-provider-tab' : 'admin-import-local-tab'}
          >
            {sourceMode === 'provider' ? (
              <div className="admin-import-v4__provider-wrap">
                <AdminExternalProviderPanel
                  compact
                  jobs={jobs}
                  onJobUpdated={handleUpdatedJob}
                  onRefresh={() => loadJobs(true)}
                />
              </div>
            ) : (
              <div className="admin-import-v4__local">
                <section className="admin-import-v4__upload" aria-labelledby="admin-import-upload-title">
                  <div className="admin-import-v4__local-heading">
                    <strong id="admin-import-upload-title">Arquivo local</strong>
                    {uploadConfig && <small>Até {formatBytes(uploadConfig.maxBytes)}</small>}
                  </div>
                  <div
                    className={`admin-import-v4__dropzone${dragging ? ' is-dragging' : ''}${uploadBusy ? ' is-disabled' : ''}`}
                    onDragEnter={event => { event.preventDefault(); if (!uploadBusy) setDragging(true); }}
                    onDragOver={event => event.preventDefault()}
                    onDragLeave={event => { event.preventDefault(); if (event.currentTarget === event.target) setDragging(false); }}
                    onDrop={onDrop}
                  >
                    <UploadCloud />
                    <strong>Arraste uma música para cá</strong>
                    <small>{uploadConfig?.acceptedExtensions.map(ext => ext.replace('.', '').toUpperCase()).join(' · ') || 'MP3 · FLAC · WAV · M4A · AAC · OGG · OPUS'}</small>
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

                <div className="admin-import-v4__or"><span>ou</span></div>

                <section className="admin-import-v4__url" aria-labelledby="admin-import-url-title">
                  <strong id="admin-import-url-title">URL direta</strong>
                  <form onSubmit={event => void submitUrl(event)}>
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

          <aside className="admin-import-v4__source-note">
            <InfoIcon />
            <span>{sourceMode === 'provider'
              ? 'Use apenas conteúdo que você tenha direito de baixar. O Home Music usa um provider externo (yt-dlp) para preparar mídias do YouTube.'
              : 'O arquivo será validado antes de continuar. Tamanho e formatos permitidos são verificados pelo sistema.'}</span>
          </aside>
        </section>
      ) : currentStep === 2 ? (
        <section className="admin-import-v4__stage">
          {validationJobs.length > 0 ? (
            mediaValidationConfig ? (
              <AdminImportMediaValidationPanel
                jobs={validationJobs}
                config={mediaValidationConfig}
                onJobUpdated={handleUpdatedJob}
                onRefresh={() => loadJobs(true)}
              />
            ) : (
              <article className="admin-import-v4__live is-failed" role="alert">
                <CircleAlert />
                <div><strong>Validação indisponível</strong><small>Não foi possível carregar os perfis de saída.</small></div>
              </article>
            )
          ) : activeProcessingJob ? (
            <article className="admin-import-v4__preparing" role="status">
              <span className="admin-import-v4__preparing-icon"><FileAudio /></span>
              <div className="admin-import-v4__preparing-copy">
                <strong>{activeProcessingJob.metadataPreview?.effective.title || activeProcessingJob.label}</strong>
                <small>{sourceLabel(activeProcessingJob)}</small>
                <div className="admin-import-v4__processing-status">
                  <LoaderCircle className="is-spinning" />
                  <div><strong>Preparando mídia</strong><small>Obtendo o conteúdo e verificando o arquivo…</small></div>
                </div>
                <div className="admin-import-v4__indeterminate"><span /></div>
              </div>
            </article>
          ) : uploadPipelineActive ? (
            <article className="admin-import-v4__preparing" role="status">
              <span className="admin-import-v4__preparing-icon"><FileAudio /></span>
              <div className="admin-import-v4__preparing-copy">
                <strong>{activeUpload?.fileName || 'Arquivo local'}</strong>
                <small>Arquivo local</small>
                <div className="admin-import-v4__processing-status">
                  <LoaderCircle className="is-spinning" />
                  <div><strong>{activeUpload ? UPLOAD_STAGE_LABELS[activeUpload.stage] : 'Preparando mídia'}</strong><small>O processo continua automaticamente quando for seguro.</small></div>
                </div>
                <div className="admin-import-v4__indeterminate"><span /></div>
              </div>
            </article>
          ) : (
            <div className="admin-import-v4__state"><LoaderCircle className="is-spinning" /> Preparando importação…</div>
          )}

          <aside className="admin-import-v4__automation-note">
            <span>⚙</span>
            <div><strong>O processo continua automaticamente</strong><small>O Home Music realiza a validação, extrai os metadados e verifica duplicatas. Você será avisado se alguma ação for necessária.</small></div>
          </aside>
        </section>
      ) : currentStep === 3 ? (
        <section className="admin-import-v4__review">
          <AdminImportMetadataPreviewPanel
            compact
            jobs={reviewJobs}
            onJobUpdated={handleUpdatedJob}
            onRefresh={() => loadJobs(true)}
          />
        </section>
      ) : (
        <section className="admin-import-v4__complete" role="status">
          <span className="admin-import-v4__complete-icon"><CheckCircle2 /></span>
          <strong>Importação concluída</strong>
          <div className="admin-import-v4__complete-track">
            <span><FileAudio /></span>
            <div>
              <strong>{newestJob?.metadataPreview?.effective.title || newestJob?.label || 'Música importada'}</strong>
              <small>{newestJob?.metadataPreview?.effective.artist || sourceLabel(newestJob!)}</small>
              {newestJob?.metadataPreview?.effective.album && <small>{newestJob.metadataPreview.effective.album}</small>}
            </div>
          </div>
          <p>A música foi adicionada à biblioteca com segurança.</p>
          <button type="button" onClick={restart}>Importar outra música</button>
        </section>
      )}
    </section>
  );
}

function InfoIcon() {
  return <CircleAlert aria-hidden="true" />;
}
