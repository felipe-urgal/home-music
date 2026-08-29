import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import type { ImportJob, ImportJobStatus } from '@home-music/shared';
import {
  Ban,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock3,
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
import {
  AdminImportMediaDecisionSummary,
  AdminImportMediaValidationPanel
} from './AdminImportMediaValidationPanel';

type AdminImportMediaScreenProps = {
  onBack: () => void;
};

type ImportMethod = {
  icon: typeof FileUp;
  title: string;
  description: string;
  available?: boolean;
};

type UploadStage = 'preparing' | 'uploading' | 'cancelling' | 'queued' | 'cancelled' | 'error';

type ActiveUpload = {
  jobId: string | null;
  fileName: string;
  size: number;
  loaded: number;
  stage: UploadStage;
  error: string | null;
};

const IMPORT_METHODS: readonly ImportMethod[] = [
  {
    icon: FileUp,
    title: 'Upload de arquivo',
    description: 'Entrada local com staging seguro, progresso e cancelamento.',
    available: true
  },
  {
    icon: Link2,
    title: 'URL direta',
    description: 'Download remoto com proteção contra SSRF, limites e validação.',
    available: true
  },
  {
    icon: Boxes,
    title: 'Fontes externas',
    description: 'Integrações isoladas para serviços e sites compatíveis.'
  }
];

const STATUS_LABELS: Record<ImportJobStatus, string> = {
  pending: 'Pendente',
  processing: 'Processando',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
};

const UPLOAD_STAGE_LABELS: Record<UploadStage, string> = {
  preparing: 'Preparando staging',
  uploading: 'Enviando arquivo',
  cancelling: 'Cancelando',
  queued: 'Aguardando validação',
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
  if (job.source.type === 'provider') return job.source.provider || 'Fonte externa';
  if (job.source.type === 'url') return 'URL';
  return 'Upload';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function formatSeconds(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  return `${seconds}s`;
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
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível carregar a fila de importação.');
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  const activeUrlJob = activeUrlJobId ? jobs.find(job => job.id === activeUrlJobId) ?? null : null;
  const urlBusy = urlSubmitting || urlCancelling || activeUrlJob?.status === 'processing';

  useEffect(() => {
    if (!activeUrlJobId || activeUrlJob?.status !== 'processing') return;
    const timer = window.setInterval(() => { void loadJobs(true); }, 1000);
    return () => window.clearInterval(timer);
  }, [activeUrlJob?.status, activeUrlJobId, loadJobs]);

  const handleValidatedJob = useCallback((job: ImportJob) => {
    setJobs(current => current.map(item => item.id === job.id ? job : item));
  }, []);

  const beginUpload = useCallback(async (file: File) => {
    if (!uploadConfig) {
      setUploadError('Configuração de upload ainda não carregada. Tente novamente.');
      return;
    }
    if (activeUpload && ['preparing', 'uploading', 'cancelling'].includes(activeUpload.stage)) {
      setUploadError('Aguarde o upload atual terminar ou cancele antes de enviar outro arquivo.');
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
    setActiveUpload({
      jobId: null,
      fileName: file.name,
      size: file.size,
      loaded: 0,
      stage: 'preparing',
      error: null
    });

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
    } catch (error) {
      if (cancelRequestedRef.current) return;
      if (createdJobId) {
        await cancelAdminImportUpload(createdJobId).catch(() => undefined);
        await loadJobs(true);
      }
      const message = error instanceof Error ? error.message : 'Não foi possível enviar o arquivo.';
      setActiveUpload(current => current ? { ...current, stage: 'error', error: message } : current);
    } finally {
      currentXhrRef.current = null;
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [activeUpload, loadJobs, uploadConfig]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const selected = Array.from(files);
    if (selected.length !== 1) {
      setUploadError('Envie um arquivo por vez para acompanhar o progresso com clareza.');
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
      setActiveUpload(current => current?.jobId === jobId
        ? { ...current, stage: 'cancelled', error: null }
        : current);
      await loadJobs(true);
    } catch (error) {
      cancelRequestedRef.current = false;
      const message = error instanceof Error ? error.message : 'Não foi possível cancelar o upload.';
      setActiveUpload(current => current?.jobId === jobId
        ? { ...current, stage: 'error', error: message }
        : current);
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
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Não foi possível iniciar a importação por URL.');
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
      setJobs(current => current.map(item => item.id === job.id ? job : item));
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Não foi possível cancelar a importação por URL.');
    } finally {
      setUrlCancelling(false);
    }
  }, [activeUrlJob, activeUrlJobId]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (uploadBusy) return;
    handleFiles(event.dataTransfer.files);
  };

  const uploadPercent = activeUpload?.size
    ? Math.min(100, Math.round((activeUpload.loaded / activeUpload.size) * 100))
    : 0;
  const uploadBusy = Boolean(activeUpload && ['preparing', 'uploading', 'cancelling'].includes(activeUpload.stage));
  const accept = uploadConfig?.acceptedExtensions.join(',') || undefined;

  return (
    <section className="my-account-screen admin-import-screen" aria-labelledby="admin-import-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-import-title">Importar mídia</strong>
          <small>Entrada única para novas músicas</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="my-account-overview admin-import-overview">
        <section className="admin-import-intro" aria-labelledby="admin-import-intro-title">
          <div>
            <span className="my-account-link-group__label">Pipeline</span>
            <strong id="admin-import-intro-title">Uma fila, várias fontes</strong>
            <p>
              Upload local e URL direta entram no mesmo staging seguro. Nenhuma dessas entradas grava direto na
              biblioteca; fontes externas serão adicionadas em uma etapa isolada.
            </p>
          </div>
        </section>

        <section className="admin-import-upload" aria-labelledby="admin-import-upload-title">
          <div className="admin-import-upload__heading">
            <div>
              <span className="my-account-link-group__label">Upload local</span>
              <strong id="admin-import-upload-title">Adicionar arquivo de áudio</strong>
            </div>
            {uploadConfig && <small>Até {formatBytes(uploadConfig.maxBytes)}</small>}
          </div>

          <div
            className={`admin-import-dropzone${dragging ? ' is-dragging' : ''}${uploadBusy ? ' is-disabled' : ''}`}
            onDragEnter={event => { event.preventDefault(); if (!uploadBusy) setDragging(true); }}
            onDragOver={event => { event.preventDefault(); }}
            onDragLeave={event => {
              event.preventDefault();
              if (event.currentTarget === event.target) setDragging(false);
            }}
            onDrop={onDrop}
          >
            <UploadCloud />
            <div>
              <strong>Arraste uma música para cá</strong>
              <small>ou selecione um arquivo do dispositivo</small>
            </div>
            <button type="button" disabled={uploadBusy || !uploadConfig} onClick={() => inputRef.current?.click()}>
              Selecionar arquivo
            </button>
            <input
              ref={inputRef}
              className="admin-import-file-input"
              type="file"
              accept={accept}
              aria-label="Selecionar arquivo de áudio"
              disabled={uploadBusy || !uploadConfig}
              onChange={event => event.target.files && handleFiles(event.target.files)}
            />
            {uploadConfig && (
              <small className="admin-import-dropzone__formats">
                {uploadConfig.acceptedExtensions.map(item => item.slice(1).toUpperCase()).join(' · ')}
              </small>
            )}
          </div>

          {uploadError && <div className="my-account-message is-error admin-import-message" role="alert">{uploadError}</div>}

          {activeUpload && (
            <article className={`admin-import-upload-status is-${activeUpload.stage}`} aria-live="polite">
              <div className="admin-import-upload-status__top">
                <div>
                  <strong>{activeUpload.fileName}</strong>
                  <small>{formatBytes(activeUpload.size)} · {UPLOAD_STAGE_LABELS[activeUpload.stage]}</small>
                </div>
                {(activeUpload.stage === 'uploading' || activeUpload.stage === 'queued') && (
                  <button type="button" onClick={() => void cancelUpload()} aria-label={`Cancelar ${activeUpload.fileName}`}>
                    <X /> Cancelar
                  </button>
                )}
              </div>
              <div className="admin-import-progress-row">
                <progress max={100} value={uploadPercent} aria-label={`Progresso do upload: ${uploadPercent}%`} />
                <strong>{uploadPercent}%</strong>
              </div>
              {activeUpload.stage === 'queued' && (
                <small className="admin-import-upload-status__hint">
                  Arquivo recebido com segurança. Ele ainda não entrou na biblioteca e aguarda validação técnica.
                </small>
              )}
              {activeUpload.error && <small className="admin-import-job__error">{activeUpload.error}</small>}
            </article>
          )}
        </section>

        <section className="admin-import-url" aria-labelledby="admin-import-url-title">
          <div className="admin-import-upload__heading">
            <div>
              <span className="my-account-link-group__label">URL direta</span>
              <strong id="admin-import-url-title">Baixar arquivo remoto</strong>
            </div>
            {urlConfig && <small>Até {formatBytes(urlConfig.maxBytes)} · {formatSeconds(urlConfig.timeoutMs)}</small>}
          </div>

          <form className="admin-import-url__form" onSubmit={event => void submitUrl(event)}>
            <label htmlFor="admin-import-url-input">Endereço do arquivo</label>
            <div className="admin-import-url__input-row">
              <input
                id="admin-import-url-input"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://exemplo.com/musica.flac"
                value={urlValue}
                disabled={urlBusy || !urlConfig}
                onChange={event => { setUrlValue(event.target.value); if (urlError) setUrlError(null); }}
              />
              <button type="submit" disabled={urlBusy || !urlConfig || !urlValue.trim()}>
                {urlSubmitting ? <LoaderCircle className="is-spinning" /> : <Link2 />}
                Importar URL
              </button>
            </div>
            {urlConfig && (
              <small>
                HTTP/HTTPS · até {urlConfig.maxRedirects} redirecionamentos · redes locais e endpoints de metadata são bloqueados.
              </small>
            )}
          </form>

          {urlError && <div className="my-account-message is-error admin-import-message" role="alert">{urlError}</div>}

          {activeUrlJob && (
            <article className={`admin-import-url-status is-${activeUrlJob.status}`} aria-live="polite">
              <span className="admin-import-job__status">{statusIcon(activeUrlJob.status)}</span>
              <div>
                <strong>{activeUrlJob.label}</strong>
                <small>
                  {activeUrlJob.status === 'processing'
                    ? 'Baixando e validando no staging seguro.'
                    : activeUrlJob.status === 'pending'
                      ? 'Arquivo remoto recebido com segurança. Aguardando validação técnica.'
                      : activeUrlJob.error || STATUS_LABELS[activeUrlJob.status]}
                </small>
              </div>
              {['processing', 'pending'].includes(activeUrlJob.status) && (
                <button type="button" disabled={urlCancelling} onClick={() => void cancelUrl()}>
                  {urlCancelling ? <LoaderCircle className="is-spinning" /> : <X />}
                  Cancelar
                </button>
              )}
            </article>
          )}
        </section>

        {mediaValidationConfig && (
          <AdminImportMediaValidationPanel
            jobs={jobs}
            config={mediaValidationConfig}
            onJobUpdated={handleValidatedJob}
            onRefresh={() => loadJobs(true)}
          />
        )}

        <section className="admin-import-methods" aria-label="Formas de importação">
          {IMPORT_METHODS.map(method => {
            const Icon = method.icon;
            return (
              <article className={`admin-import-method${method.available ? ' is-available' : ''}`} key={method.title}>
                <span className="admin-import-method__icon"><Icon /></span>
                <div>
                  <strong>{method.title}</strong>
                  <small>{method.description}</small>
                </div>
                <span className="admin-import-method__badge">{method.available ? 'Disponível' : 'Em breve'}</span>
              </article>
            );
          })}
        </section>

        <section className="admin-import-queue" aria-labelledby="admin-import-queue-title">
          <div className="admin-import-queue__heading">
            <div>
              <span className="my-account-link-group__label" id="admin-import-queue-title">Fila de importação</span>
              <small>Importações mais recentes</small>
            </div>
            <button
              type="button"
              aria-label="Atualizar fila de importação"
              disabled={loading || refreshing}
              onClick={() => void loadJobs(true)}
            >
              <RefreshCw className={refreshing ? 'is-spinning' : ''} />
            </button>
          </div>

          {error && (
            <div className="my-account-message is-error admin-import-message" role="alert">
              <span>{error}</span>
              <button type="button" onClick={() => void loadJobs()}>Tentar novamente</button>
            </div>
          )}

          {loading ? (
            <div className="admin-import-empty" role="status">
              <LoaderCircle className="is-spinning" /> Carregando fila…
            </div>
          ) : jobs.length === 0 ? (
            <div className="admin-import-empty">
              <Clock3 />
              <div>
                <strong>Nenhuma importação na fila</strong>
                <small>Envie um arquivo ou informe uma URL acima para iniciar o primeiro job.</small>
              </div>
            </div>
          ) : (
            <div className="admin-import-job-list">
              {jobs.map(job => (
                <article className={`admin-import-job is-${job.status}`} key={job.id}>
                  <span className="admin-import-job__status">{statusIcon(job.status)}</span>
                  <div className="admin-import-job__body">
                    <strong>{job.label}</strong>
                    <small>{sourceLabel(job)} · {formatDate(job.createdAt)}</small>
                    <AdminImportMediaDecisionSummary job={job} />
                    {job.error && <small className="admin-import-job__error">{job.error}</small>}
                  </div>
                  <span className="admin-import-job__badge">{STATUS_LABELS[job.status]}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
