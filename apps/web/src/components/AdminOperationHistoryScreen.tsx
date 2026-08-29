import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminOperationKind,
  AdminOperationStatus
} from '@home-music/shared';
import {
  Ban,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  Clock3,
  FileInput,
  Link2,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Upload
} from 'lucide-react';
import {
  getAdminOperationHistory,
  retryAdminOperation,
  type AdminImportFailureDisposition,
  type AdminOperationHistoryItemWithRetry
} from '../admin-operation-history-client';
import { uploadAdminImportFile } from '../admin-import-client';

type AdminOperationHistoryScreenProps = {
  onBack: () => void;
};

type KindFilter = AdminOperationKind | '';
type StatusFilter = AdminOperationStatus | '';

const STATUS_LABELS: Record<AdminOperationStatus, string> = {
  pending: 'Pendente',
  running: 'Em andamento',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada'
};

const FAILURE_LABELS: Record<AdminImportFailureDisposition, string> = {
  none: '—',
  retryable: 'Recuperável',
  definitive: 'Definitiva'
};

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function formatDuration(value: number | null, status: AdminOperationStatus) {
  if (value == null) return status === 'running' ? 'Em andamento' : '—';
  if (value < 1_000) return `${value} ms`;
  const seconds = value / 1_000;
  if (seconds < 60) return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return remaining > 0 ? `${minutes} min ${remaining} s` : `${minutes} min`;
}

function statusIcon(status: AdminOperationStatus) {
  switch (status) {
    case 'pending': return <Clock3 />;
    case 'running': return <LoaderCircle className="is-spinning" />;
    case 'completed': return <CheckCircle2 />;
    case 'failed': return <CircleAlert />;
    case 'cancelled': return <Ban />;
  }
}

function operationSource(item: AdminOperationHistoryItemWithRetry) {
  if (item.kind === 'scan') return item.scanTrigger === 'automatic' ? 'Automático' : 'Manual';
  if (item.importSource?.type === 'provider') return item.importSource.provider || 'Fonte externa';
  if (item.importSource?.type === 'url') return 'URL';
  if (item.importSource?.type === 'upload') return 'Upload';
  return 'Importação';
}

function scanCounts(item: AdminOperationHistoryItemWithRetry) {
  if (item.kind !== 'scan' || item.counts.tracks == null) return null;
  return [
    ['Faixas', item.counts.tracks],
    ['Adicionadas', item.counts.added],
    ['Atualizadas', item.counts.updated],
    ['Removidas', item.counts.removed],
    ['Sem mudança', item.counts.unchanged]
  ] as const;
}

export function AdminOperationHistoryScreen({ onBack }: AdminOperationHistoryScreenProps) {
  const [items, setItems] = useState<AdminOperationHistoryItemWithRetry[]>([]);
  const [kind, setKind] = useState<KindFilter>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [retryUrl, setRetryUrl] = useState('');
  const [retryProgress, setRetryProgress] = useState<number | null>(null);
  const requestSequence = useRef(0);
  const retryFileInput = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async (background = false) => {
    const requestId = ++requestSequence.current;
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }
    setError(null);
    try {
      const response = await getAdminOperationHistory({
        kind: kind || undefined,
        status: status || undefined
      });
      if (requestId !== requestSequence.current) return;
      setItems(response.items);
      setSelectedId(current => current && response.items.some(item => item.id === current) ? current : null);
    } catch (error) {
      if (requestId !== requestSequence.current) return;
      setError(error instanceof Error ? error.message : 'Não foi possível carregar o histórico operacional.');
    } finally {
      if (requestId !== requestSequence.current) return;
      if (background) setRefreshing(false); else setLoading(false);
    }
  }, [kind, status]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);
  useEffect(() => {
    setRetryError(null);
    setRetryNotice(null);
    setRetryUrl('');
    setRetryProgress(null);
  }, [selectedId]);

  const selected = useMemo(
    () => items.find(item => item.id === selectedId) ?? null,
    [items, selectedId]
  );
  const selectedCounts = selected ? scanCounts(selected) : null;
  const selectedAttempt = selected?.importRetry?.attempt ?? 1;

  const retryUpload = async (file: File) => {
    if (!selected?.canRetry || selected.importSource?.type !== 'upload' || retrying) return;
    setRetrying(true);
    setRetryError(null);
    setRetryNotice(null);
    setRetryProgress(0);
    try {
      const job = await retryAdminOperation(selected.id, { fileName: file.name, size: file.size });
      const upload = uploadAdminImportFile(job.id, file, (loaded, total) => {
        setRetryProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
      });
      await upload.promise;
      setRetryProgress(100);
      setRetryNotice(`Tentativa #${selectedAttempt + 1} criada com um staging novo. Continue a revisão em Importar mídia.`);
      await loadHistory(true);
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'Não foi possível criar a nova tentativa.');
      await loadHistory(true).catch(() => undefined);
    } finally {
      setRetrying(false);
    }
  };

  const retryFromUrl = async () => {
    if (!selected?.canRetry || selected.importSource?.type !== 'url' || retrying || !retryUrl.trim()) return;
    setRetrying(true);
    setRetryError(null);
    setRetryNotice(null);
    try {
      await retryAdminOperation(selected.id, { url: retryUrl.trim() });
      setRetryNotice(`Tentativa #${selectedAttempt + 1} criada com uma nova aquisição da URL.`);
      setRetryUrl('');
      await loadHistory(true);
    } catch (caught) {
      setRetryError(caught instanceof Error ? caught.message : 'Não foi possível criar a nova tentativa.');
      await loadHistory(true).catch(() => undefined);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <section className="my-account-screen admin-operation-history-screen" aria-labelledby="admin-operation-history-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-operation-history-title">Histórico operacional</strong>
          <small>Scans e importações da biblioteca</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="my-account-overview admin-operation-history">
        <section className="admin-operation-history__toolbar" aria-label="Filtros do histórico operacional">
          <label>
            <span>Tipo</span>
            <select value={kind} onChange={event => setKind(event.target.value as KindFilter)}>
              <option value="">Todos</option>
              <option value="scan">Scans</option>
              <option value="import">Importações</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={status} onChange={event => setStatus(event.target.value as StatusFilter)}>
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="running">Em andamento</option>
              <option value="completed">Concluída</option>
              <option value="failed">Falhou</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
          <button
            type="button"
            aria-label="Atualizar histórico operacional"
            disabled={loading || refreshing}
            onClick={() => void loadHistory(true)}
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} />
          </button>
        </section>

        {error && (
          <div className="my-account-message is-error admin-operation-history__message" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void loadHistory()}>Tentar novamente</button>
          </div>
        )}

        {loading ? (
          <div className="admin-operation-history__empty" role="status">
            <LoaderCircle className="is-spinning" /> Carregando histórico…
          </div>
        ) : items.length === 0 ? (
          <div className="admin-operation-history__empty">
            <Clock3 />
            <div>
              <strong>Nenhuma operação encontrada</strong>
              <small>Os próximos scans manuais/automáticos e jobs de importação aparecerão aqui.</small>
            </div>
          </div>
        ) : (
          <div className="admin-operation-history__layout">
            <div className="admin-operation-history__list" aria-label="Operações recentes">
              {items.map(item => (
                <button
                  className={`admin-operation-row is-${item.status} ${selectedId === item.id ? 'is-selected' : ''}`}
                  type="button"
                  key={item.id}
                  aria-pressed={selectedId === item.id}
                  onClick={() => setSelectedId(current => current === item.id ? null : item.id)}
                >
                  <span className="admin-operation-row__icon">
                    {item.kind === 'scan' ? <ScanLine /> : <FileInput />}
                  </span>
                  <span className="admin-operation-row__body">
                    <strong>{item.label}</strong>
                    <small>
                      {operationSource(item)}
                      {item.importRetry && item.importRetry.attempt > 1 ? ` · tentativa #${item.importRetry.attempt}` : ''}
                      {' · '}{formatDate(item.createdAt)}
                    </small>
                  </span>
                  <span className="admin-operation-row__status">
                    {statusIcon(item.status)} {STATUS_LABELS[item.status]}
                  </span>
                </button>
              ))}
            </div>

            {selected && (
              <article className="admin-operation-detail" aria-live="polite">
                <div className="admin-operation-detail__heading">
                  <span>{selected.kind === 'scan' ? <ScanLine /> : <FileInput />}</span>
                  <div>
                    <strong>{selected.label}</strong>
                    <small>{operationSource(selected)} · {STATUS_LABELS[selected.status]}</small>
                  </div>
                </div>

                <dl className="admin-operation-detail__facts">
                  <div><dt>Início</dt><dd>{formatDate(selected.startedAt || selected.createdAt)}</dd></div>
                  <div><dt>Fim</dt><dd>{formatDate(selected.finishedAt)}</dd></div>
                  <div><dt>Duração</dt><dd>{formatDuration(selected.durationMs, selected.status)}</dd></div>
                  {selected.importRetry && (
                    <>
                      <div><dt>Tentativa</dt><dd>#{selected.importRetry.attempt}</dd></div>
                      <div><dt>Diagnóstico</dt><dd>{FAILURE_LABELS[selected.importRetry.failureDisposition]}</dd></div>
                      <div><dt>Nova tentativa</dt><dd>{selected.canRetry ? 'Disponível' : 'Não disponível'}</dd></div>
                    </>
                  )}
                </dl>

                {selectedCounts && (
                  <dl className="admin-operation-detail__counts">
                    {selectedCounts.map(([label, value]) => (
                      <div key={label}><dt>{label}</dt><dd>{value?.toLocaleString('pt-BR') ?? '—'}</dd></div>
                    ))}
                  </dl>
                )}

                {selected.error && (
                  <div className="admin-operation-detail__error" role="alert">
                    <strong>{selected.error.message}</strong>
                    <span>O que fazer: {selected.error.action}</span>
                  </div>
                )}

                {selected.kind === 'import' && selected.importRetry?.failureDisposition === 'definitive' && (
                  <div className="admin-operation-detail__retry-note">
                    <CircleAlert />
                    <span>Falha definitiva. Corrija a origem e inicie uma nova importação em vez de repetir este job.</span>
                  </div>
                )}

                {selected.canRetry && selected.importSource?.type === 'upload' && (
                  <div className="admin-operation-detail__retry">
                    <div>
                      <Upload />
                      <span>
                        <strong>Nova tentativa com arquivo novo</strong>
                        <small>O arquivo anterior não é reutilizado. Um staging vazio será criado.</small>
                      </span>
                    </div>
                    <input
                      ref={retryFileInput}
                      className="admin-operation-detail__retry-file"
                      type="file"
                      accept=".mp3,.flac,.wav,.m4a,.aac,.ogg,.opus"
                      disabled={retrying}
                      onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = '';
                        if (file) void retryUpload(file);
                      }}
                    />
                    <button type="button" disabled={retrying} onClick={() => retryFileInput.current?.click()}>
                      {retrying ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                      {retrying ? `Enviando${retryProgress != null ? ` ${retryProgress}%` : '…'}` : 'Selecionar arquivo e tentar novamente'}
                    </button>
                  </div>
                )}

                {selected.canRetry && selected.importSource?.type === 'url' && (
                  <form className="admin-operation-detail__retry" onSubmit={event => { event.preventDefault(); void retryFromUrl(); }}>
                    <div>
                      <Link2 />
                      <span>
                        <strong>Nova tentativa com URL informada novamente</strong>
                        <small>A URL anterior não é persistida nem reaproveitada pelo histórico.</small>
                      </span>
                    </div>
                    <label htmlFor={`admin-operation-retry-url-${selected.id}`}>URL</label>
                    <input
                      id={`admin-operation-retry-url-${selected.id}`}
                      type="url"
                      value={retryUrl}
                      disabled={retrying}
                      maxLength={4096}
                      placeholder="https://…"
                      onChange={event => setRetryUrl(event.target.value)}
                    />
                    <button type="submit" disabled={retrying || !retryUrl.trim()}>
                      {retrying ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                      {retrying ? 'Criando tentativa…' : 'Tentar novamente'}
                    </button>
                  </form>
                )}

                {retryError && <div className="admin-operation-detail__retry-message is-error" role="alert">{retryError}</div>}
                {retryNotice && <div className="admin-operation-detail__retry-message is-success" role="status">{retryNotice}</div>}
              </article>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
