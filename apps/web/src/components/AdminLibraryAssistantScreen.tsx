import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isLibraryAssistantAutoApplicable,
  type LibraryAssistantDecision,
  type LibraryAssistantReviewItem,
  type LibraryAssistantRun,
  type LibraryAssistantRunProgress,
  type LibraryAssistantSuggestion,
  type LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  FileText,
  Info,
  List,
  LoaderCircle,
  MoreVertical,
  Music2,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  XCircle
} from 'lucide-react';
import {
  cancelLibraryAssistantRun,
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  getLibraryAssistantReview,
  getLibraryAssistantRunProgress,
  getLibraryAssistantRuns,
  getLibraryAssistantSuggestions,
  startLibraryAssistantMetadataRun
} from '../library-assistant-client';
import { notifyLibraryChanged } from '../library-events';
import '../library-assistant-admin.css';

type Props = { onBack: () => void };
type Filter = 'all' | 'open' | 'safe' | 'review' | 'applied' | 'rejected' | 'failed';
type Sort = 'recent' | 'oldest';
type Feedback = { kind: 'success' | 'error' | 'warning'; message: string };

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'stale']);
const FILTERS: readonly [Filter, string][] = [
  ['all', 'Todas'],
  ['open', 'Abertas'],
  ['safe', 'Seguras'],
  ['review', 'Revisão'],
  ['applied', 'Aplicadas'],
  ['rejected', 'Rejeitadas'],
  ['failed', 'Falhas']
];
const FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista do álbum'
};
const EMPTY_PROGRESS: LibraryAssistantRunProgress = {
  total: 0,
  processed: 0,
  pending: 0,
  processing: 0,
  matched: 0,
  noMatch: 0,
  retry: 0,
  failed: 0
};

function isOpen(suggestion: LibraryAssistantSuggestion) {
  return suggestion.status === 'pending' || suggestion.status === 'review';
}

function isSafe(suggestion: LibraryAssistantSuggestion) {
  return isLibraryAssistantAutoApplicable(suggestion);
}

function statusLabel(status: LibraryAssistantSuggestionStatus) {
  return ({
    pending: 'Pendente',
    review: 'Revisão',
    applied: 'Aplicada',
    rejected: 'Rejeitada',
    stale: 'Desatualizada',
    failed: 'Falhou'
  } satisfies Record<LibraryAssistantSuggestionStatus, string>)[status];
}

function runTitle(run: LibraryAssistantRun | null) {
  if (!run) return 'Pronto para analisar sua biblioteca';
  if (run.status === 'queued' || run.status === 'running') return 'Analisando sua biblioteca';
  if (run.status === 'failed') return 'Análise interrompida';
  if (run.status === 'cancelled') return 'Análise cancelada';
  if (run.status === 'stale') return 'Análise desatualizada';
  return 'Análise concluída';
}

function runDescription(run: LibraryAssistantRun | null) {
  if (!run) return 'Enriqueça seus metadados com o MusicBrainz. Nada é aplicado sem sua confirmação.';
  if (run.status === 'queued' || run.status === 'running') {
    return 'Enriquecendo seus metadados com o MusicBrainz. O processamento é automático e continua em segundo plano.';
  }
  if (run.status === 'failed') {
    return run.error?.message ?? 'O processamento foi interrompido. Você pode iniciar uma nova análise.';
  }
  if (run.status === 'cancelled') return 'O processamento foi cancelado. As sugestões já encontradas continuam disponíveis.';
  if (run.status === 'stale') return 'A biblioteca mudou desde esta análise. Execute uma nova análise para trabalhar com dados atuais.';
  return run.summary.total === 0
    ? 'A análise terminou sem sugestões de metadata.'
    : `${run.summary.total} sugestão${run.summary.total === 1 ? '' : 'ões'} encontrada${run.summary.total === 1 ? '' : 's'} para revisão.`;
}

function runStatusLabel(run: LibraryAssistantRun | null) {
  if (!run) return 'Aguardando';
  if (run.status === 'queued') return 'Na fila';
  if (run.status === 'running') return 'Em andamento';
  if (run.status === 'completed') return 'Concluída';
  if (run.status === 'failed') return 'Interrompida';
  if (run.status === 'cancelled') return 'Cancelada';
  return 'Desatualizada';
}

function mergeSuggestions(
  history: LibraryAssistantSuggestion[],
  reviewItems: LibraryAssistantReviewItem[],
  runId: string | null
) {
  const byId = new Map(history.map(suggestion => [suggestion.id, suggestion]));
  if (runId) {
    for (const item of reviewItems) {
      if (item.suggestion.runId === runId) byId.set(item.suggestion.id, item.suggestion);
    }
  }
  return [...byId.values()];
}

function statusTone(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.status === 'failed') return 'is-error';
  if (suggestion.status === 'applied') return 'is-safe';
  if (suggestion.status === 'rejected' || suggestion.status === 'stale') return 'is-muted';
  return isSafe(suggestion) ? 'is-safe' : 'is-review';
}

function rowStatusLabel(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.status === 'pending' || suggestion.status === 'review') {
    return isSafe(suggestion) ? 'Confiança alta' : 'Revisão';
  }
  return statusLabel(suggestion.status);
}

export function AdminLibraryAssistantScreen({ onBack }: Props) {
  const [runs, setRuns] = useState<LibraryAssistantRun[]>([]);
  const [suggestions, setSuggestions] = useState<LibraryAssistantSuggestion[]>([]);
  const [reviewItems, setReviewItems] = useState<LibraryAssistantReviewItem[]>([]);
  const [progress, setProgress] = useState<LibraryAssistantRunProgress>(EMPTY_PROGRESS);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [search, setSearch] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [batching, setBatching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const requestVersion = useRef(0);

  const latestRun = useMemo(() => runs.find(run => run.capability === 'metadata') ?? null, [runs]);
  const runActive = Boolean(latestRun && !TERMINAL_RUNS.has(latestRun.status));
  const reviewMap = useMemo(() => new Map(reviewItems.map(item => [item.suggestion.id, item])), [reviewItems]);
  const safeSuggestions = useMemo(() => suggestions.filter(isSafe), [suggestions]);
  const reviewSuggestions = useMemo(() => suggestions.filter(item => isOpen(item) && !isSafe(item)), [suggestions]);
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');

  const visibleSuggestions = useMemo(() => {
    const filtered = suggestions.filter(suggestion => {
      if (filter !== 'all') {
        if (filter === 'open' && !isOpen(suggestion)) return false;
        if (filter === 'safe' && !isSafe(suggestion)) return false;
        if (filter === 'review' && (!isOpen(suggestion) || isSafe(suggestion))) return false;
        if (!['open', 'safe', 'review'].includes(filter) && suggestion.status !== filter) return false;
      }
      if (!normalizedSearch) return true;
      const item = reviewMap.get(suggestion.id);
      const target = suggestion.target.capability === 'metadata' ? suggestion.target : null;
      return [
        item?.track.title,
        item?.track.artist,
        item?.track.album,
        target?.currentValue,
        target?.suggestedValue
      ].some(value => value?.toLocaleLowerCase('pt-BR').includes(normalizedSearch));
    });
    return filtered.sort((left, right) => {
      const created = left.createdAt.localeCompare(right.createdAt);
      const stable = created || left.id.localeCompare(right.id);
      return sort === 'recent' ? -stable : stable;
    });
  }, [filter, normalizedSearch, reviewMap, sort, suggestions]);

  const visibleSafeSuggestions = useMemo(() => visibleSuggestions.filter(isSafe), [visibleSuggestions]);

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const runsResponse = await getLibraryAssistantRuns();
      if (version !== requestVersion.current) return;
      const metadataRun = runsResponse.runs.find(run => run.capability === 'metadata') ?? null;
      const [reviewResponse, suggestionResponse, progressResponse] = await Promise.all([
        getLibraryAssistantReview(),
        metadataRun ? getLibraryAssistantSuggestions(metadataRun.id) : Promise.resolve({ suggestions: [] }),
        metadataRun ? getLibraryAssistantRunProgress(metadataRun.id) : Promise.resolve({ progress: EMPTY_PROGRESS })
      ]);
      if (version !== requestVersion.current) return;
      setRuns(runsResponse.runs);
      setReviewItems(reviewResponse.items);
      setSuggestions(mergeSuggestions(
        suggestionResponse.suggestions,
        reviewResponse.items,
        metadataRun?.id ?? null
      ));
      setProgress(progressResponse.progress);
    } catch (error) {
      if (version === requestVersion.current) {
        setFeedback({
          kind: 'error',
          message: error instanceof Error
            ? error.message
            : 'Não foi possível carregar o Assistente da Biblioteca.'
        });
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!runActive) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      await load(true);
      if (!cancelled) timer = window.setTimeout(() => void tick(), 1_500);
    };
    timer = window.setTimeout(() => void tick(), 1_500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [latestRun?.id, runActive, load]);

  useEffect(() => setSelected(new Set()), [filter, latestRun?.id, search]);

  async function analyze() {
    if (analyzing || mutating || runActive) return;
    setAnalyzing(true);
    setFeedback(null);
    try {
      const run = (await startLibraryAssistantMetadataRun()).run;
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      setProgress(EMPTY_PROGRESS);
      setSuggestions([]);
      setReviewItems([]);
      setSelected(new Set());
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível iniciar a análise.'
      });
    } finally {
      setAnalyzing(false);
    }
  }

  async function cancelAnalysis() {
    const run = runs.find(item => item.capability === 'metadata' && !TERMINAL_RUNS.has(item.status));
    if (!run) return;
    try {
      await cancelLibraryAssistantRun(run.id);
      setFeedback({
        kind: 'warning',
        message: 'Cancelamento solicitado. Itens já concluídos não são revertidos.'
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível cancelar.'
      });
    }
  }

  function decisionFor(
    suggestion: LibraryAssistantSuggestion,
    action: 'apply' | 'reject'
  ): LibraryAssistantDecision | null {
    const item = reviewMap.get(suggestion.id);
    if (!item || suggestion.target.capability !== 'metadata') return null;
    return {
      runId: suggestion.runId,
      suggestionId: suggestion.id,
      action,
      expectedLibraryRevision: item.runLibraryRevision,
      expectedCurrentValue: suggestion.target.currentValue
    };
  }

  async function decideOne(suggestion: LibraryAssistantSuggestion, action: 'apply' | 'reject') {
    const decision = decisionFor(suggestion, action);
    if (!decision || mutating || runActive) return;
    setMutating(true);
    setFeedback(null);
    try {
      const { result } = await decideLibraryAssistantSuggestion(decision);
      if (result.outcome === 'applied') {
        notifyLibraryChanged();
        setFeedback({ kind: 'success', message: 'Sugestão aplicada. A biblioteca foi atualizada sem rescan.' });
      } else if (result.outcome === 'rejected') {
        setFeedback({ kind: 'success', message: 'Sugestão rejeitada e mantida no histórico da análise.' });
      } else if (result.outcome === 'already-applied' || result.outcome === 'already-rejected') {
        setFeedback({ kind: 'success', message: 'Esta sugestão já havia sido resolvida. A revisão foi atualizada.' });
      } else if (result.outcome === 'stale') {
        setFeedback({ kind: 'warning', message: result.message ?? 'A sugestão ficou desatualizada. Analise novamente.' });
      } else {
        setFeedback({ kind: 'error', message: result.message ?? 'A decisão não pôde ser concluída.' });
      }
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'A decisão não pôde ser concluída.'
      });
    } finally {
      setMutating(false);
    }
  }

  async function applySelected() {
    if (runActive) return;
    const decisions = suggestions
      .filter(item => selected.has(item.id) && isSafe(item))
      .map(item => decisionFor(item, 'apply'))
      .filter((item): item is LibraryAssistantDecision => Boolean(item));
    if (mutating || decisions.length === 0) return;

    let applied = 0;
    let stale = 0;
    let failed = 0;
    let alreadyResolved = 0;
    setMutating(true);
    setBatching(true);
    setFeedback(null);
    try {
      for (const decision of decisions) {
        try {
          const response = await decideLibraryAssistantBatch([decision]);
          const item = response.results[0];
          if (item?.outcome === 'applied') applied += 1;
          else if (item?.outcome === 'stale') stale += 1;
          else if (item?.outcome === 'already-applied' || item?.outcome === 'already-rejected') alreadyResolved += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (applied > 0) notifyLibraryChanged();
      const details = [`${applied} aplicada${applied === 1 ? '' : 's'}`];
      if (alreadyResolved) details.push(`${alreadyResolved} já resolvida${alreadyResolved === 1 ? '' : 's'}`);
      if (stale) details.push(`${stale} desatualizada${stale === 1 ? '' : 's'}`);
      if (failed) details.push(`${failed} com erro`);
      setSelected(new Set());
      setFeedback({
        kind: stale || failed ? 'warning' : 'success',
        message: `Lote concluído: ${details.join(', ')}.`
      });
      await load(true);
    } finally {
      setBatching(false);
      setMutating(false);
    }
  }

  const totalTracks = progress.total;
  const processedTracks = Math.min(progress.processed, totalTracks);
  const progressPercent = totalTracks > 0 ? Math.min(100, Math.round((processedTracks / totalTracks) * 100)) : 0;
  const pendingTracks = progress.pending + progress.processing;
  const queueFailureCount = progress.failed;
  const suggestionFailureCount = latestRun?.summary.failed ?? 0;
  const failedCount = Math.max(queueFailureCount, suggestionFailureCount);
  const failedRun = latestRun?.status === 'failed';

  return (
    <section className="assistant-admin" aria-labelledby="library-assistant-title">
      <header className="assistant-admin__header">
        <button className="assistant-admin__back" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="assistant-admin__header-copy">
          <strong id="library-assistant-title">Assistente da Biblioteca</strong>
          <small>Encontre metadados melhores, revise as diferenças e decida o que aplicar.</small>
        </div>
        <div className="assistant-admin__header-actions">
          <button
            type="button"
            className="assistant-admin__secondary-button"
            aria-pressed={showHelp}
            onClick={() => setShowHelp(value => !value)}
          >
            <Info /> Como funciona?
          </button>
          <button
            type="button"
            className="assistant-admin__secondary-button"
            aria-label="Atualizar Assistente da Biblioteca"
            disabled={loading || mutating}
            onClick={() => void load()}
          >
            <RefreshCw className={loading ? 'is-spinning' : ''} />
            Atualizar
          </button>
        </div>
      </header>

      {showHelp && (
        <aside className="assistant-admin__help" role="note">
          <Sparkles />
          <div>
            <strong>O assistente só propõe alterações</strong>
            <span>Ele consulta o MusicBrainz faixa por faixa, salva cada resultado e continua em segundo plano. Nada é aplicado automaticamente.</span>
          </div>
        </aside>
      )}

      {feedback && (
        <div className={`assistant-admin__feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'success' ? <Check /> : <AlertTriangle />}
          <span>{feedback.message}</span>
        </div>
      )}

      <section className={`assistant-admin__hero${failedRun ? ' is-error' : ''}`} aria-label="Estado da análise">
        <div className="assistant-admin__hero-main">
          <div className="assistant-admin__hero-icon" aria-hidden="true"><Music2 /></div>
          <div className="assistant-admin__hero-copy">
            <div className="assistant-admin__hero-titleline">
              <strong>{runTitle(latestRun)}</strong>
              <span className={`assistant-admin__run-badge is-${latestRun?.status ?? 'idle'}`}>
                {runActive && <span className="assistant-admin__status-dot" />}
                {runStatusLabel(latestRun)}
              </span>
            </div>
            <span>{runDescription(latestRun)}</span>
          </div>
        </div>

        <div className="assistant-admin__progress-block">
          <div className="assistant-admin__progress-heading">
            <strong>
              {totalTracks > 0 ? processedTracks.toLocaleString('pt-BR') : 0}
              <span> de {totalTracks.toLocaleString('pt-BR')} faixas processadas</span>
            </strong>
            <strong>{progressPercent}%</strong>
          </div>
          <div
            className="assistant-admin__progress-track"
            role="progressbar"
            aria-label="Progresso da análise"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <i style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className="assistant-admin__hero-footer">
          <dl className="assistant-admin__queue-metrics">
            <div className="is-found"><CheckCircle2 /><dt>Encontradas</dt><dd>{progress.matched.toLocaleString('pt-BR')}</dd></div>
            <div className="is-pending"><Clock3 /><dt>Pendentes</dt><dd>{pendingTracks.toLocaleString('pt-BR')}</dd></div>
            <div className="is-retry"><AlertTriangle /><dt>Em retry</dt><dd>{progress.retry.toLocaleString('pt-BR')}</dd></div>
            <div className="is-empty"><XCircle /><dt>Sem resultado</dt><dd>{progress.noMatch.toLocaleString('pt-BR')}</dd></div>
          </dl>
          {runActive ? (
            <button className="assistant-admin__danger-button" type="button" disabled={mutating} onClick={() => void cancelAnalysis()}>
              <X /> Cancelar análise
            </button>
          ) : (
            <button className="assistant-admin__primary-button" type="button" disabled={analyzing || mutating} onClick={() => void analyze()}>
              {analyzing ? <LoaderCircle className="is-spinning" /> : <Sparkles />}
              {latestRun ? 'Analisar novamente' : 'Analisar biblioteca'}
            </button>
          )}
        </div>
      </section>

      <nav className="assistant-admin__sections" aria-label="Seções do Assistente da Biblioteca">
        <button type="button" className="is-active" aria-current="page"><List /> Sugestões</button>
        <button type="button" aria-disabled="true"><List /> Fila</button>
        <button type="button" aria-disabled="true"><BarChart3 /> Estatísticas</button>
        <button type="button" aria-disabled="true"><Settings /> Configurações</button>
      </nav>

      <dl className="assistant-admin__metrics" aria-label="Resumo das sugestões">
        <div className="is-suggestions"><span className="assistant-admin__metric-icon"><FileText /></span><dt>Sugestões</dt><dd>{latestRun?.summary.total ?? suggestions.length}</dd></div>
        <div className="is-safe"><span className="assistant-admin__metric-icon"><ShieldCheck /></span><dt>Seguras</dt><dd>{safeSuggestions.length}</dd></div>
        <div className="is-review"><span className="assistant-admin__metric-icon"><AlertTriangle /></span><dt>Revisão</dt><dd>{reviewSuggestions.length}</dd></div>
        <div className="is-failed"><span className="assistant-admin__metric-icon"><XCircle /></span><dt>Falhas</dt><dd>{failedCount}</dd></div>
      </dl>

      <section className="assistant-admin__review" aria-labelledby="assistant-review-title">
        <header className="assistant-admin__review-heading">
          <div>
            <strong id="assistant-review-title">Sugestões de metadados</strong>
            <small>Revise as diferenças encontradas e escolha o que aplicar.</small>
          </div>
          <div className="assistant-admin__selection-actions">
            <button
              type="button"
              className="assistant-admin__secondary-button"
              disabled={mutating || visibleSafeSuggestions.length === 0}
              onClick={() => setSelected(new Set(visibleSafeSuggestions.map(item => item.id)))}
            >
              Selecionar seguras
            </button>
            <button
              type="button"
              className="assistant-admin__primary-button"
              disabled={mutating || runActive || selected.size === 0}
              onClick={() => void applySelected()}
            >
              {batching ? <LoaderCircle className="is-spinning" /> : <Check />}
              {batching ? 'Aplicando…' : `Aplicar selecionadas (${selected.size})`}
            </button>
          </div>
        </header>

        <div className="assistant-admin__toolbar">
          <nav className="assistant-admin__filters" aria-label="Filtros das sugestões">
            {FILTERS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </nav>
          <label className="assistant-admin__search">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar por artista, álbum ou faixa…"
              aria-label="Buscar sugestões"
            />
          </label>
          <label className="assistant-admin__sort">
            <select value={sort} onChange={event => setSort(event.target.value as Sort)} aria-label="Ordenar sugestões">
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigas</option>
            </select>
            <ChevronDown aria-hidden="true" />
          </label>
        </div>

        <div className="assistant-admin__review-content">
          {loading && suggestions.length === 0 ? (
            <div className="assistant-admin__empty" role="status">
              <LoaderCircle className="is-spinning" />
              <div><strong>Carregando sugestões</strong><span>Buscando o estado mais recente do assistente.</span></div>
            </div>
          ) : failedRun && suggestions.length === 0 ? (
            <div className="assistant-admin__empty">
              <AlertTriangle />
              <div><strong>Nenhuma sugestão disponível</strong><span>Inicie uma nova análise para tentar novamente.</span></div>
            </div>
          ) : !latestRun ? (
            <div className="assistant-admin__empty">
              <Sparkles />
              <div><strong>Ainda não há sugestões para revisar</strong><span>Inicie uma análise para comparar sua biblioteca com o MusicBrainz.</span></div>
            </div>
          ) : latestRun.status === 'completed' && latestRun.summary.total === 0 ? (
            <div className="assistant-admin__empty">
              <Check />
              <div><strong>Nenhuma sugestão encontrada</strong><span>A análise terminou sem candidatos de metadata.</span></div>
            </div>
          ) : visibleSuggestions.length === 0 ? (
            <div className="assistant-admin__empty">
              {runActive ? <LoaderCircle className="is-spinning" /> : <Search />}
              <div>
                <strong>{runActive ? 'Aguardando as próximas sugestões' : 'Nenhum resultado neste filtro'}</strong>
                <span>{runActive ? 'Os resultados aparecerão aqui conforme cada faixa for processada.' : 'Ajuste o filtro ou a busca para encontrar outras sugestões.'}</span>
              </div>
            </div>
          ) : (
            <div className="assistant-admin__list" aria-live="polite">
              {visibleSuggestions.map(suggestion => {
                const item = reviewMap.get(suggestion.id);
                const target = suggestion.target.capability === 'metadata' ? suggestion.target : null;
                const safe = isSafe(suggestion);
                const canDecide = Boolean(item && target && isOpen(suggestion) && !runActive);
                const selectable = Boolean(item && target && isOpen(suggestion) && safe);
                return (
                  <article key={suggestion.id} className="assistant-admin-row">
                    <label className="assistant-admin-row__select" aria-label={`Selecionar ${item?.track.title ?? suggestion.target.trackId}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(suggestion.id)}
                        disabled={!selectable}
                        onChange={event => setSelected(current => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(suggestion.id);
                          else next.delete(suggestion.id);
                          return next;
                        })}
                      />
                    </label>
                    <span className="assistant-admin-row__artwork" aria-hidden="true"><Music2 /></span>
                    <div className="assistant-admin-row__identity">
                      <strong>{item?.track.artist ?? 'Faixa da biblioteca'}</strong>
                      <span>{item?.track.title ?? `Faixa ${suggestion.target.trackId}`}</span>
                    </div>
                    <div className="assistant-admin-row__meta">
                      <Music2 aria-hidden="true" />
                      <span><small>Álbum</small><strong>{item?.track.album || '—'}</strong></span>
                    </div>
                    <div className="assistant-admin-row__meta assistant-admin-row__change">
                      <FileText aria-hidden="true" />
                      <span>
                        <small>{target ? FIELD_LABELS[target.field] ?? target.field : 'Sugestão'}</small>
                        <strong>{target?.suggestedValue || '—'}</strong>
                      </span>
                    </div>
                    <span className={`assistant-admin-row__status ${statusTone(suggestion)}`}>
                      {safe && isOpen(suggestion) ? <CheckCircle2 /> : suggestion.status === 'failed' ? <XCircle /> : <AlertTriangle />}
                      {rowStatusLabel(suggestion)}
                    </span>
                    {canDecide ? (
                      <details className="assistant-admin-row__menu">
                        <summary aria-label={`Ações para ${item?.track.title ?? suggestion.target.trackId}`}><MoreVertical /></summary>
                        <div>
                          <button type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'apply')}><Check /> Aplicar</button>
                          <button type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'reject')}><X /> Rejeitar</button>
                        </div>
                      </details>
                    ) : (
                      <button className="assistant-admin-row__menu-disabled" type="button" disabled aria-label="Ações indisponíveis"><MoreVertical /></button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {showInfo && (
          <aside className="assistant-admin__info" role="note">
            <Info />
            <div>
              <strong>O processamento pode levar algum tempo.</strong>
              <span>Você pode sair desta página. A análise continuará em segundo plano.</span>
            </div>
            <button type="button" onClick={() => setShowInfo(false)}>Entendi</button>
          </aside>
        )}
      </section>
    </section>
  );
}
