import { useCallback, useEffect, useState } from 'react';
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
  RefreshCw
} from 'lucide-react';
import { getAdminImportJobs } from '../admin-import-client';

type AdminImportMediaScreenProps = {
  onBack: () => void;
};

type ImportMethod = {
  icon: typeof FileUp;
  title: string;
  description: string;
};

const IMPORT_METHODS: readonly ImportMethod[] = [
  {
    icon: FileUp,
    title: 'Upload de arquivo',
    description: 'Entrada local com staging, validação e progresso.'
  },
  {
    icon: Link2,
    title: 'URL direta',
    description: 'Importação de mídia remota suportada pelo pipeline.'
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

export function AdminImportMediaScreen({ onBack }: AdminImportMediaScreenProps) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async (background = false) => {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await getAdminImportJobs();
      setJobs(response.jobs);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível carregar a fila de importação.');
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }, []);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

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
              Todas as importações passam pela mesma fila e seguem estados claros de execução. Upload, URL e
              fontes externas serão habilitados nas próximas etapas.
            </p>
          </div>
        </section>

        <section className="admin-import-methods" aria-label="Formas de importação planejadas">
          {IMPORT_METHODS.map(method => {
            const Icon = method.icon;
            return (
              <article className="admin-import-method" key={method.title}>
                <span className="admin-import-method__icon"><Icon /></span>
                <div>
                  <strong>{method.title}</strong>
                  <small>{method.description}</small>
                </div>
                <span className="admin-import-method__badge">Em breve</span>
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
                <small>As próximas formas de entrada usarão esta mesma fila.</small>
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
