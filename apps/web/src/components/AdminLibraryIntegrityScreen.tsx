import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminLibraryIntegrityIssueKind } from '@home-music/shared';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Database,
  LoaderCircle,
  ScanLine
} from 'lucide-react';
import {
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
      const nextOverview = await getAdminLibraryOverview();
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

  return (
    <section className="my-account-screen admin-library-integrity-screen" aria-labelledby="admin-library-integrity-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-library-integrity-title">Integridade da biblioteca</strong>
          <small>Arquivos quebrados e divergências do índice</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="my-account-overview admin-library-integrity">
        <section className="admin-library-integrity__intro">
          <div>
            <span className="my-account-link-group__label">Última verificação</span>
            <strong>{formatDate(integrity?.checkedAt ?? null)}</strong>
            <small>A verificação é somente leitura: não remove nem altera arquivos ou registros.</small>
          </div>
          <div className="admin-library-integrity__actions">
            <button
              type="button"
              className="admin-library-integrity__rescan"
              disabled={loading || checking}
              onClick={() => void runIntegrityCheck()}
            >
              {checking ? <LoaderCircle className="is-spinning" /> : <ScanLine />}
              {checking ? 'Verificando…' : 'Verificar agora'}
            </button>
          </div>
        </section>

        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className="my-account-message is-success" role="status">{feedback}</div>}

        {loading && !overview ? (
          <div className="admin-library-integrity__state" role="status">
            <LoaderCircle className="is-spinning" /> Carregando integridade…
          </div>
        ) : integrity ? (
          <>
            <section className="admin-library-integrity__metrics" aria-label="Resumo das inconsistências">
              <article>
                <AlertTriangle />
                <div><small>Total</small><strong>{integrity.counts.total.toLocaleString('pt-BR')}</strong></div>
              </article>
              <article>
                <ScanLine />
                <div><small>Scanner / ffprobe</small><strong>{(integrity.counts.scannerFailures + integrity.counts.mediaProbeFailures).toLocaleString('pt-BR')}</strong></div>
              </article>
              <article>
                <Database />
                <div><small>Registro sem arquivo</small><strong>{integrity.counts.missingFiles.toLocaleString('pt-BR')}</strong></div>
              </article>
              <article>
                <Database />
                <div><small>Fora do índice</small><strong>{integrity.counts.unindexedFiles.toLocaleString('pt-BR')}</strong></div>
              </article>
            </section>

            <section className="admin-library-integrity__review" aria-labelledby="admin-library-integrity-review-title">
              <div className="admin-library-integrity__review-heading">
                <div>
                  <strong id="admin-library-integrity-review-title">Revisão</strong>
                  <small>{integrity.counts.total === 0 ? 'Nenhuma inconsistência registrada.' : 'Classificação e caminho relativo da última verificação.'}</small>
                </div>
                <label>
                  <span>Categoria</span>
                  <select value={filter} onChange={event => setFilter(event.target.value as IntegrityFilter)}>
                    <option value="">Todas</option>
                    <option value="scanner-failed">Falha do scanner</option>
                    <option value="media-probe-failed">Falha no ffprobe</option>
                    <option value="missing-file">Registro sem arquivo</option>
                    <option value="unindexed-file">Arquivo fora do índice</option>
                  </select>
                </label>
              </div>

              {visibleIssues.length === 0 ? (
                <div className="admin-library-integrity__state is-success">
                  <CheckCircle2 /> {filter ? 'Nenhum item nesta categoria.' : 'Nenhuma inconsistência detectada.'}
                </div>
              ) : (
                <div className="admin-library-integrity__issues">
                  {visibleIssues.map(issue => (
                    <article key={`${issue.kind}-${issue.trackId || 'file'}-${issue.relativePath}`}>
                      <div className="admin-library-integrity__issue-heading">
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
