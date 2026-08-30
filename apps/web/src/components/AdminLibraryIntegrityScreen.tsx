import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminLibraryIntegrityIssueKind } from '@home-music/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Database,
  LoaderCircle,
  ScanLine,
  ShieldCheck
} from 'lucide-react';
import {
  checkAdminLibraryIntegrity,
  getAdminLibraryOverview,
  type AdminLibraryHealthOverview
} from '../admin-library-client';

type AdminLibraryIntegrityScreenProps = {
  onBack: () => void;
};

type IntegrityFilter = AdminLibraryIntegrityIssueKind | '';

const ISSUE_LABELS: Record<AdminLibraryIntegrityIssueKind, string> = {
  'scanner-failed': 'Falha do scanner',
  'media-probe-failed': 'Falha no ffprobe',
  'missing-file': 'Registro sem arquivo',
  'unindexed-file': 'Arquivo fora do índice'
};

function formatDate(value: string | null) {
  if (!value) return 'Ainda não verificada';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function AdminLibraryIntegrityScreen({ onBack }: AdminLibraryIntegrityScreenProps) {
  const [overview, setOverview] = useState<AdminLibraryHealthOverview | null>(null);
  const [filter, setFilter] = useState<IntegrityFilter>('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOverview(await getAdminLibraryOverview());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível carregar a integridade da biblioteca.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  const integrity = overview?.integrity ?? null;
  const hasVerification = Boolean(integrity?.checkedAt);
  const totalIssues = integrity?.counts.total ?? 0;
  const hasIssues = hasVerification && totalIssues > 0;
  const visibleIssues = useMemo(
    () => integrity?.issues.filter(issue => !filter || issue.kind === filter) ?? [],
    [filter, integrity]
  );

  async function runIntegrityCheck() {
    if (checking) return;
    setChecking(true);
    setError(null);
    setFeedback(null);
    try {
      const nextOverview = await checkAdminLibraryIntegrity();
      setOverview(nextOverview);
      const total = nextOverview.integrity.counts.total;
      setFeedback(
        total === 0
          ? 'Verificação concluída sem inconsistências.'
          : `Verificação concluída: ${total.toLocaleString('pt-BR')} ${total === 1 ? 'inconsistência encontrada' : 'inconsistências encontradas'}.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Não foi possível verificar a integridade da biblioteca.');
    } finally {
      setChecking(false);
    }
  }

  const statusTitle = checking
    ? 'Verificando biblioteca…'
    : !hasVerification
      ? 'Integridade ainda não verificada'
      : hasIssues
        ? 'Atenção necessária'
        : 'Biblioteca íntegra';

  const statusDescription = checking
    ? 'A auditoria está comparando arquivos e índice sem alterar nenhum dado.'
    : !hasVerification
      ? 'Execute a primeira auditoria para gerar um diagnóstico confiável.'
      : hasIssues
        ? `${totalIssues.toLocaleString('pt-BR')} ${totalIssues === 1 ? 'inconsistência precisa' : 'inconsistências precisam'} de revisão.`
        : 'A última auditoria não encontrou divergências entre arquivos e índice.';

  return (
    <section
      className="my-account-screen admin-library-integrity-screen admin-library-integrity-screen--v3"
      aria-labelledby="admin-library-integrity-title"
    >
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-library-integrity-title">Integridade da biblioteca</strong>
          <small>Diagnóstico seguro de arquivos e índice</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-integrity-v3">
        <section className={`admin-integrity-v3__hero${hasIssues ? ' is-warning' : hasVerification ? ' is-success' : ' is-neutral'}${checking ? ' is-checking' : ''}`}>
          <div className="admin-integrity-v3__hero-icon" aria-hidden="true">
            {checking ? <LoaderCircle className="is-spinning" /> : hasIssues ? <AlertTriangle /> : hasVerification ? <ShieldCheck /> : <ScanLine />}
          </div>
          <div className="admin-integrity-v3__hero-copy">
            <span>Diagnóstico</span>
            <strong>{statusTitle}</strong>
            <small>{statusDescription}</small>
            <div className="admin-integrity-v3__hero-meta">
              <span>Última verificação: {formatDate(integrity?.checkedAt ?? null)}</span>
              <span>Somente leitura</span>
            </div>
          </div>
          <button
            type="button"
            className="admin-integrity-v3__check"
            disabled={loading || checking}
            onClick={() => void runIntegrityCheck()}
          >
            {checking ? <LoaderCircle className="is-spinning" /> : <ScanLine />}
            {checking ? 'Verificando…' : 'Verificar agora'}
          </button>
        </section>

        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className="my-account-message is-success" role="status">{feedback}</div>}

        {loading && !overview ? (
          <div className="admin-integrity-v3__loading" role="status">
            <LoaderCircle className="is-spinning" /> Carregando integridade…
          </div>
        ) : integrity ? (
          <>
            <section className="admin-integrity-v3__metrics" aria-label="Filtrar inconsistências por categoria">
              <button type="button" className={filter === '' ? 'is-active' : ''} aria-pressed={filter === ''} disabled={!hasVerification} onClick={() => setFilter('')}>
                <AlertTriangle />
                <span><small>Total</small><strong>{hasVerification ? integrity.counts.total.toLocaleString('pt-BR') : '—'}</strong></span>
              </button>
              <button type="button" className={filter === 'scanner-failed' ? 'is-active' : ''} aria-pressed={filter === 'scanner-failed'} disabled={!hasVerification} onClick={() => setFilter('scanner-failed')}>
                <ScanLine />
                <span><small>Scanner</small><strong>{hasVerification ? integrity.counts.scannerFailures.toLocaleString('pt-BR') : '—'}</strong></span>
              </button>
              <button type="button" className={filter === 'media-probe-failed' ? 'is-active' : ''} aria-pressed={filter === 'media-probe-failed'} disabled={!hasVerification} onClick={() => setFilter('media-probe-failed')}>
                <ScanLine />
                <span><small>FFprobe</small><strong>{hasVerification ? integrity.counts.mediaProbeFailures.toLocaleString('pt-BR') : '—'}</strong></span>
              </button>
              <button type="button" className={filter === 'missing-file' ? 'is-active' : ''} aria-pressed={filter === 'missing-file'} disabled={!hasVerification} onClick={() => setFilter('missing-file')}>
                <Database />
                <span><small>Sem arquivo</small><strong>{hasVerification ? integrity.counts.missingFiles.toLocaleString('pt-BR') : '—'}</strong></span>
              </button>
              <button type="button" className={filter === 'unindexed-file' ? 'is-active' : ''} aria-pressed={filter === 'unindexed-file'} disabled={!hasVerification} onClick={() => setFilter('unindexed-file')}>
                <Database />
                <span><small>Fora do índice</small><strong>{hasVerification ? integrity.counts.unindexedFiles.toLocaleString('pt-BR') : '—'}</strong></span>
              </button>
            </section>

            <section className="admin-integrity-v3__attention" aria-labelledby="admin-integrity-v3-attention-title">
              <header>
                <div>
                  <span>Atenção necessária</span>
                  <strong id="admin-integrity-v3-attention-title">
                    {!hasVerification
                      ? 'Aguardando primeira verificação'
                      : totalIssues === 0
                        ? 'Nenhum problema encontrado'
                        : filter
                          ? ISSUE_LABELS[filter]
                          : `${totalIssues.toLocaleString('pt-BR')} ${totalIssues === 1 ? 'inconsistência' : 'inconsistências'}`}
                  </strong>
                  <small>
                    {!hasVerification
                      ? 'A auditoria é somente leitura e pode ser executada com segurança.'
                      : totalIssues === 0
                        ? 'Arquivos e índice estavam consistentes na última auditoria.'
                        : filter
                          ? `${visibleIssues.length.toLocaleString('pt-BR')} ${visibleIssues.length === 1 ? 'item nesta categoria' : 'itens nesta categoria'}.`
                          : 'Revise os itens abaixo. Nada é removido automaticamente por esta tela.'}
                  </small>
                </div>
                {filter && (
                  <button type="button" onClick={() => setFilter('')}>Mostrar todas</button>
                )}
              </header>

              {!hasVerification ? (
                <div className="admin-integrity-v3__state">
                  <ScanLine />
                  <span>Clique em <strong>Verificar agora</strong> para analisar a biblioteca.</span>
                </div>
              ) : visibleIssues.length === 0 ? (
                <div className="admin-integrity-v3__state is-success">
                  <CheckCircle2 />
                  <span>{filter ? 'Nenhum item nesta categoria.' : 'Nenhuma inconsistência detectada.'}</span>
                </div>
              ) : (
                <div className="admin-integrity-v3__issues">
                  {visibleIssues.map(issue => (
                    <article key={`${issue.kind}-${issue.trackId || 'file'}-${issue.relativePath}`}>
                      <div className="admin-integrity-v3__issue-kind">
                        <span>{ISSUE_LABELS[issue.kind]}</span>
                        {issue.trackId && <code>{issue.trackId}</code>}
                      </div>
                      <strong>{issue.relativePath}</strong>
                      <small>{issue.message}</small>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
}
