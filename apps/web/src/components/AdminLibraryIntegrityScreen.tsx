import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AdminLibraryIntegrityIssueKind } from '@home-music/shared';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  FileWarning,
  FileX2,
  FolderSearch2,
  Info,
  Lightbulb,
  ListMusic,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  Video,
  Wrench
} from 'lucide-react';
import {
  checkAdminLibraryIntegrity,
  getAdminLibraryOverview,
  type AdminLibraryHealthOverview
} from '../admin-library-client';

type AdminLibraryIntegrityScreenProps = {
  onBack: () => void;
  onOpenTracks?: () => void;
  onOpenMetadata?: () => void;
  onOpenDuplicates?: () => void;
};

type IntegrityFilter = AdminLibraryIntegrityIssueKind | '';

const ISSUE_LABELS: Record<AdminLibraryIntegrityIssueKind, string> = {
  'scanner-failed': 'Falha de leitura',
  'media-probe-failed': 'FFprobe',
  'missing-file': 'Sem arquivo',
  'unindexed-file': 'Fora do índice'
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

function formatDuration(milliseconds: number | null) {
  if (milliseconds == null) return null;
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes === 0) return `${remaining}s`;
  return `${minutes}m ${remaining.toString().padStart(2, '0')}s`;
}

export function AdminLibraryIntegrityScreen({
  onBack,
  onOpenTracks,
  onOpenMetadata,
  onOpenDuplicates
}: AdminLibraryIntegrityScreenProps) {
  const [overview, setOverview] = useState<AdminLibraryHealthOverview | null>(null);
  const [filter, setFilter] = useState<IntegrityFilter>('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);
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
  const mediaProbeLabel = integrity?.mediaProbe.available === true
    ? 'FFprobe disponível'
    : integrity?.mediaProbe.available === false
      ? 'FFprobe indisponível'
      : 'FFprobe não verificado';

  const visibleIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    return integrity?.issues.filter(issue => {
      if (filter && issue.kind !== filter) return false;
      if (!normalizedQuery) return true;
      return [ISSUE_LABELS[issue.kind], issue.relativePath, issue.message, issue.trackId ?? '']
        .some(value => value.toLocaleLowerCase('pt-BR').includes(normalizedQuery));
    }) ?? [];
  }, [filter, integrity, query]);

  async function runIntegrityCheck() {
    if (checking) return;
    const startedAt = performance.now();
    setChecking(true);
    setError(null);
    setFeedback(null);
    try {
      const nextOverview = await checkAdminLibraryIntegrity();
      setOverview(nextOverview);
      setLastDurationMs(performance.now() - startedAt);
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
    ? 'Comparando arquivos físicos e índice sem alterar nenhum dado.'
    : !hasVerification
      ? 'Execute a primeira auditoria para gerar um diagnóstico confiável.'
      : hasIssues
        ? `${totalIssues.toLocaleString('pt-BR')} ${totalIssues === 1 ? 'inconsistência encontrada' : 'inconsistências encontradas'}.`
        : 'Nenhuma inconsistência encontrada.';

  const metricCards = integrity ? [
    {
      kind: 'scanner-failed' as const,
      icon: <FileWarning />,
      count: integrity.counts.scannerFailures,
      title: 'Falha de leitura',
      description: 'Arquivos que não puderam ser lidos.'
    },
    {
      kind: 'media-probe-failed' as const,
      icon: <Video />,
      count: integrity.counts.mediaProbeFailures,
      title: 'Falha no FFprobe',
      description: 'Arquivos com problema na validação.'
    },
    {
      kind: 'missing-file' as const,
      icon: <FileX2 />,
      count: integrity.counts.missingFiles,
      title: 'Sem arquivo',
      description: 'Registros no índice sem arquivo físico.'
    },
    {
      kind: 'unindexed-file' as const,
      icon: <FolderSearch2 />,
      count: integrity.counts.unindexedFiles,
      title: 'Fora do índice',
      description: 'Arquivos físicos não indexados.'
    }
  ] : [];

  return (
    <section
      className="my-account-screen admin-library-integrity-screen admin-library-integrity-screen--v4"
      aria-labelledby="admin-library-integrity-title"
    >
      <header className="admin-integrity-v4__page-header">
        <button className="admin-integrity-v4__back" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div>
          <strong id="admin-library-integrity-title">Integridade da biblioteca</strong>
          <small>Diagnóstico seguro de arquivos e índice</small>
        </div>
        <div className={`admin-integrity-v4__probe ${integrity?.mediaProbe.available === true ? 'is-ok' : integrity?.mediaProbe.available === false ? 'is-warning' : ''}`}>
          <span />
          <div>
            <strong>{mediaProbeLabel}</strong>
            <small>{integrity?.mediaProbe.available === true ? 'Validação de mídia ativa' : integrity?.mediaProbe.message ?? 'Será verificado na próxima auditoria'}</small>
          </div>
        </div>
      </header>

      <div className="admin-integrity-v4">
        {error && <div className="my-account-message is-error" role="alert">{error}</div>}
        {feedback && <div className={`my-account-message${hasIssues ? '' : ' is-success'}`} role="status">{feedback}</div>}

        {loading && !overview ? (
          <div className="admin-integrity-v4__loading" role="status">
            <LoaderCircle className="is-spinning" /> Carregando integridade…
          </div>
        ) : integrity ? (
          <>
            <section className={`admin-integrity-v4__hero ${hasIssues ? 'is-warning' : hasVerification ? 'is-success' : 'is-neutral'} ${checking ? 'is-checking' : ''}`}>
              <div className="admin-integrity-v4__hero-icon" aria-hidden="true">
                {checking ? <LoaderCircle className="is-spinning" /> : hasIssues ? <AlertTriangle /> : hasVerification ? <Check /> : <FolderSearch2 />}
              </div>
              <div className="admin-integrity-v4__hero-copy">
                <strong>{statusTitle}</strong>
                <small>{statusDescription}</small>
              </div>
              <div className="admin-integrity-v4__hero-meta">
                <CalendarDays />
                <div>
                  <small>Última verificação</small>
                  <strong>{formatDate(integrity.checkedAt)}</strong>
                  {formatDuration(lastDurationMs) && <span>Duração: {formatDuration(lastDurationMs)}</span>}
                </div>
              </div>
              <button
                type="button"
                className="admin-integrity-v4__check"
                disabled={loading || checking}
                onClick={() => void runIntegrityCheck()}
              >
                {checking ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
                {checking ? 'Verificando…' : 'Verificar agora'}
              </button>
            </section>

            <section className="admin-integrity-v4__metrics" aria-label="Resumo da integridade">
              {metricCards.map(card => (
                <button
                  key={card.kind}
                  type="button"
                  className={`is-${card.kind} ${filter === card.kind ? 'is-active' : ''}`}
                  aria-pressed={filter === card.kind}
                  disabled={!hasVerification}
                  onClick={() => setFilter(current => current === card.kind ? '' : card.kind)}
                >
                  <span className="admin-integrity-v4__metric-icon">{card.icon}</span>
                  <span>
                    <strong>{hasVerification ? card.count.toLocaleString('pt-BR') : '—'}</strong>
                    <b>{card.title}</b>
                    <small>{card.description}</small>
                  </span>
                </button>
              ))}
            </section>

            <div className="admin-integrity-v4__middle-grid">
              <section className="admin-integrity-v4__panel admin-integrity-v4__tools" aria-labelledby="admin-integrity-tools-title">
                <header>
                  <Wrench />
                  <div>
                    <strong id="admin-integrity-tools-title">Ferramentas relacionadas</strong>
                    <small>Corrija problemas encontrados com as ferramentas adequadas.</small>
                  </div>
                </header>
                <div>
                  <button type="button" disabled={!onOpenTracks} onClick={onOpenTracks}>
                    <ListMusic />
                    <span><strong>Gerenciar músicas</strong><small>Adicionar ou remover arquivos.</small></span>
                  </button>
                  <button type="button" disabled={!onOpenMetadata} onClick={onOpenMetadata}>
                    <Sparkles />
                    <span><strong>Metadados</strong><small>Corrigir informações.</small></span>
                  </button>
                  <button type="button" disabled={!onOpenDuplicates} onClick={onOpenDuplicates}>
                    <Copy />
                    <span><strong>Duplicatas</strong><small>Encontrar músicas duplicadas.</small></span>
                  </button>
                </div>
              </section>

              <section className="admin-integrity-v4__panel admin-integrity-v4__about" aria-labelledby="admin-integrity-about-title">
                <header>
                  <Info />
                  <div>
                    <strong id="admin-integrity-about-title">Sobre esta verificação</strong>
                    <small>A integridade apenas verifica, não altera nenhum dado.</small>
                  </div>
                </header>
                <ul>
                  <li><Check />Compara arquivos físicos com o índice</li>
                  <li><Check />Valida a leitura de metadados</li>
                  <li><Check />Verifica arquivos com FFprobe</li>
                  <li><Check />Identifica registros sem arquivo</li>
                  <li><Check />Encontra arquivos não indexados</li>
                </ul>
              </section>
            </div>

            <section className="admin-integrity-v4__results" aria-labelledby="admin-integrity-results-title">
              <header>
                <nav aria-label="Filtrar inconsistências">
                  <button className={filter === '' ? 'is-active' : ''} type="button" onClick={() => setFilter('')}>
                    Todos ({hasVerification ? totalIssues.toLocaleString('pt-BR') : '—'})
                  </button>
                  <button className={filter === 'scanner-failed' ? 'is-active' : ''} type="button" onClick={() => setFilter('scanner-failed')}>
                    Falha de leitura ({hasVerification ? integrity.counts.scannerFailures.toLocaleString('pt-BR') : '—'})
                  </button>
                  <button className={filter === 'media-probe-failed' ? 'is-active' : ''} type="button" onClick={() => setFilter('media-probe-failed')}>
                    FFprobe ({hasVerification ? integrity.counts.mediaProbeFailures.toLocaleString('pt-BR') : '—'})
                  </button>
                  <button className={filter === 'missing-file' ? 'is-active' : ''} type="button" onClick={() => setFilter('missing-file')}>
                    Sem arquivo ({hasVerification ? integrity.counts.missingFiles.toLocaleString('pt-BR') : '—'})
                  </button>
                  <button className={filter === 'unindexed-file' ? 'is-active' : ''} type="button" onClick={() => setFilter('unindexed-file')}>
                    Fora do índice ({hasVerification ? integrity.counts.unindexedFiles.toLocaleString('pt-BR') : '—'})
                  </button>
                </nav>

                <label className="admin-integrity-v4__search">
                  <Search />
                  <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Buscar nos resultados…"
                    aria-label="Buscar nos resultados"
                  />
                </label>
              </header>

              <div className="admin-integrity-v4__result-body" id="admin-integrity-results-title">
                {checking ? (
                  <div className="admin-integrity-v4__empty">
                    <LoaderCircle className="is-spinning" />
                    <strong>Analisando biblioteca…</strong>
                    <small>Comparando arquivos e índice atual.</small>
                  </div>
                ) : !hasVerification ? (
                  <div className="admin-integrity-v4__empty">
                    <FolderSearch2 />
                    <strong>Aguardando primeira verificação</strong>
                    <small>Clique em Verificar agora para analisar a biblioteca.</small>
                  </div>
                ) : visibleIssues.length === 0 ? (
                  <div className="admin-integrity-v4__empty is-success">
                    <CheckCircle2 />
                    <strong>{query || filter ? 'Nenhum resultado encontrado' : 'Nenhuma inconsistência encontrada'}</strong>
                    <small>{query || filter ? 'Ajuste os filtros ou a busca.' : 'Sua biblioteca está consistente.'}</small>
                  </div>
                ) : (
                  <div className="admin-integrity-v4__issues">
                    {visibleIssues.map(issue => (
                      <article key={`${issue.kind}-${issue.trackId || 'file'}-${issue.relativePath}`}>
                        <div>
                          <span>{ISSUE_LABELS[issue.kind]}</span>
                          {issue.trackId && <code>{issue.trackId}</code>}
                        </div>
                        <strong>{issue.relativePath}</strong>
                        <small>{issue.message}</small>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <aside className="admin-integrity-v4__tip">
              <Lightbulb />
              <span>Dica: execute esta verificação sempre que adicionar, remover ou mover arquivos na sua biblioteca.</span>
            </aside>
          </>
        ) : null}
      </div>
    </section>
  );
}
