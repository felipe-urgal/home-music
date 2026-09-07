import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isLibraryAssistantAutoApplicable,
  type LibraryAssistantDecision,
  type LibraryAssistantReviewItem,
  type LibraryAssistantRun,
  type LibraryAssistantSuggestion,
  type LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  X
} from 'lucide-react';
import {
  cancelLibraryAssistantRun,
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  getLibraryAssistantReview,
  getLibraryAssistantRun,
  getLibraryAssistantRuns,
  getLibraryAssistantSuggestions,
  startLibraryAssistantMetadataRun
} from '../library-assistant-client';
import { notifyLibraryChanged } from '../library-events';
import '../library-assistant-admin.css';

type Props = { onBack: () => void };
type Filter = 'all' | 'open' | 'safe' | 'review' | 'stale' | 'applied' | 'rejected' | 'failed';
type Feedback = { kind: 'success' | 'error' | 'warning'; message: string };

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'stale']);
const FILTERS: readonly [Filter, string][] = [
  ['all', 'Todas'],
  ['open', 'Abertas'],
  ['safe', 'Seguras'],
  ['review', 'Revisão'],
  ['stale', 'Desatualizadas'],
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
const REASON_LABELS: Record<string, string> = {
  'provider-match': 'Correspondência encontrada no provedor',
  'exact-text-match': 'Texto coincide exatamente',
  'normalized-text-match': 'Texto coincide após normalização',
  'duration-close': 'Duração compatível',
  'duration-mismatch': 'Duração divergente',
  'album-context': 'Contexto do álbum reforça a identificação',
  'source-conflict': 'Fontes apresentam conflito',
  'metadata-conflict': 'Metadados apresentam conflito',
  'human-override': 'Existe uma decisão humana neste metadado',
  'ambiguous-candidates': 'Há mais de um candidato plausível',
  'strong-external-id': 'Identificador externo forte',
  'local-review': 'Revisão local necessária',
  'metadata-missing': 'Metadado ausente'
};

function isOpen(suggestion: LibraryAssistantSuggestion) {
  return suggestion.status === 'pending' || suggestion.status === 'review';
}

function isSafe(suggestion: LibraryAssistantSuggestion) {
  return isLibraryAssistantAutoApplicable(suggestion);
}

function confidenceLabel(value: LibraryAssistantSuggestion['confidence']) {
  return value === 'high'
    ? 'Alta confiança'
    : value === 'medium'
      ? 'Confiança média'
      : 'Baixa confiança';
}

function statusLabel(status: LibraryAssistantSuggestionStatus) {
  return ({
    pending: 'Pendente',
    review: 'Revisão necessária',
    applied: 'Aplicada',
    rejected: 'Rejeitada',
    stale: 'Desatualizada',
    failed: 'Falhou'
  } satisfies Record<LibraryAssistantSuggestionStatus, string>)[status];
}

function runTitle(run: LibraryAssistantRun | null) {
  if (!run) return 'Pronto para analisar sua biblioteca';
  if (run.status === 'queued' || run.status === 'running') return 'Analisando sua biblioteca…';
  if (run.status === 'failed') return 'Análise interrompida';
  if (run.status === 'cancelled') return 'Análise cancelada';
  if (run.status === 'stale') return 'Análise desatualizada';
  return run.summary.total === 0 ? 'Análise concluída' : 'Sugestões prontas para revisão';
}

function runDescription(run: LibraryAssistantRun | null) {
  if (!run) return 'Compare seus metadados com o MusicBrainz. Nada é aplicado sem sua confirmação.';
  if (run.status === 'queued' || run.status === 'running') {
    return 'Consultando o MusicBrainz em lotes de 10 faixas e isolando automaticamente consultas problemáticas.';
  }
  if (run.status === 'failed') {
    return run.error?.message ?? 'O último processamento não terminou. Você pode tentar novamente sem aplicar nenhuma alteração.';
  }
  if (run.status === 'cancelled') return 'O processamento foi interrompido e nenhuma sugestão foi aplicada automaticamente.';
  if (run.status === 'stale') return 'A biblioteca mudou desde esta análise. Execute uma nova análise antes de continuar.';
  if (run.summary.total === 0) return 'A análise terminou sem candidatos confiáveis para alterar seus metadados.';
  return `${run.summary.total} sugestão${run.summary.total === 1 ? '' : 'ões'} encontrada${run.summary.total === 1 ? '' : 's'}. Revise antes de aplicar.`;
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

function formatRunDate(run: LibraryAssistantRun | null) {
  if (!run) return 'Ainda não há análises concluídas.';
  const raw = run.finishedAt ?? run.startedAt ?? run.createdAt;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return runStatusLabel(run);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function sleep(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
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
  return [...byId.values()].sort((left, right) => {
    const created = left.createdAt.localeCompare(right.createdAt);
    return created || left.id.localeCompare(right.id);
  });
}

export function AdminLibraryAssistantScreen({ onBack }: Props) {
  const [runs, setRuns] = useState<LibraryAssistantRun[]>([]);
  const [suggestions, setSuggestions] = useState<LibraryAssistantSuggestion[]>([]);
  const [reviewItems, setReviewItems] = useState<LibraryAssistantReviewItem[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [batching, setBatching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const requestVersion = useRef(0);
  const analysisVersion = useRef(0);
  const batchVersion = useRef(0);

  const latestRun = useMemo(() => runs.find(run => run.capability === 'metadata') ?? null, [runs]);
  const reviewMap = useMemo(() => new Map(reviewItems.map(item => [item.suggestion.id, item])), [reviewItems]);
  const safeSuggestions = useMemo(() => suggestions.filter(isSafe), [suggestions]);
  const reviewSuggestions = useMemo(() => suggestions.filter(item => isOpen(item) && !isSafe(item)), [suggestions]);
  const openSuggestions = useMemo(() => suggestions.filter(isOpen), [suggestions]);
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const visibleSuggestions = useMemo(() => suggestions.filter(suggestion => {
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
  }), [filter, normalizedSearch, reviewMap, suggestions]);
  const visibleSafeSuggestions = useMemo(() => visibleSuggestions.filter(isSafe), [visibleSuggestions]);

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const [runsResponse, reviewResponse] = await Promise.all([
        getLibraryAssistantRuns(),
        getLibraryAssistantReview()
      ]);
      if (version !== requestVersion.current) return;
      const metadataRun = runsResponse.runs.find(run => run.capability === 'metadata') ?? null;
      const suggestionResponse = metadataRun
        ? await getLibraryAssistantSuggestions(metadataRun.id)
        : { suggestions: [] };
      if (version !== requestVersion.current) return;
      setRuns(runsResponse.runs);
      setReviewItems(reviewResponse.items);
      setSuggestions(mergeSuggestions(
        suggestionResponse.suggestions,
        reviewResponse.items,
        metadataRun?.id ?? null
      ));
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
    return () => {
      requestVersion.current += 1;
      analysisVersion.current += 1;
      batchVersion.current += 1;
    };
  }, [load]);

  useEffect(() => setSelected(new Set()), [filter, latestRun?.id, search]);

  async function analyze() {
    if (analyzing || mutating) return;
    const version = ++analysisVersion.current;
    setAnalyzing(true);
    setFeedback(null);
    try {
      let run = (await startLibraryAssistantMetadataRun()).run;
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      while (!TERMINAL_RUNS.has(run.status)) {
        await sleep(1_500);
        if (version !== analysisVersion.current) return;
        run = (await getLibraryAssistantRun(run.id)).run;
        if (version !== analysisVersion.current) return;
        setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      }
      setFeedback(run.status === 'failed'
        ? null
        : run.status === 'cancelled'
          ? { kind: 'warning', message: 'Análise cancelada. Nenhuma sugestão foi aplicada automaticamente.' }
          : run.summary.total === 0
            ? { kind: 'success', message: 'Análise concluída sem candidatos de metadata. Nenhuma alteração foi aplicada.' }
            : { kind: 'success', message: 'Análise concluída. Revise as sugestões antes de aplicar.' });
      await load(true);
    } catch (error) {
      if (version === analysisVersion.current) {
        setFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Não foi possível iniciar a análise.'
        });
      }
    } finally {
      if (version === analysisVersion.current) setAnalyzing(false);
    }
  }

  async function cancelAnalysis() {
    const run = runs.find(item => item.capability === 'metadata' && !TERMINAL_RUNS.has(item.status));
    if (!run) return;
    try {
      await cancelLibraryAssistantRun(run.id);
      analysisVersion.current += 1;
      setAnalyzing(false);
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
    if (!decision || mutating) return;
    setMutating(true);
    setFeedback(null);
    try {
      const { result } = await decideLibraryAssistantSuggestion(decision);
      if (result.outcome === 'applied') {
        notifyLibraryChanged();
        setFeedback({
          kind: 'success',
          message: 'Sugestão aplicada. A biblioteca foi atualizada sem rescan.'
        });
      } else if (result.outcome === 'rejected') {
        setFeedback({
          kind: 'success',
          message: 'Sugestão rejeitada e mantida no histórico da análise.'
        });
      } else if (result.outcome === 'already-applied' || result.outcome === 'already-rejected') {
        setFeedback({
          kind: 'success',
          message: 'Esta sugestão já havia sido resolvida. A revisão foi atualizada.'
        });
      } else if (result.outcome === 'stale') {
        setFeedback({
          kind: 'warning',
          message: result.message ?? 'A sugestão ficou desatualizada. Analise novamente.'
        });
      } else {
        setFeedback({
          kind: 'error',
          message: result.message ?? 'A decisão não pôde ser concluída.'
        });
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

  function cancelBatch() {
    if (!batching) return;
    batchVersion.current += 1;
    setFeedback({
      kind: 'warning',
      message: 'Cancelamento do lote solicitado. O item em andamento pode concluir; nenhum novo item será iniciado.'
    });
  }

  async function applySelected() {
    const decisions = suggestions
      .filter(item => selected.has(item.id) && isSafe(item))
      .map(item => decisionFor(item, 'apply'))
      .filter((item): item is LibraryAssistantDecision => Boolean(item));
    if (mutating || decisions.length === 0) return;

    const version = ++batchVersion.current;
    let processed = 0;
    let applied = 0;
    let stale = 0;
    let failed = 0;
    let alreadyResolved = 0;
    setMutating(true);
    setBatching(true);
    setFeedback(null);

    try {
      for (const decision of decisions) {
        if (version !== batchVersion.current) break;
        try {
          const response = await decideLibraryAssistantBatch([decision]);
          const item = response.results[0];
          processed += 1;
          if (item?.outcome === 'applied') applied += 1;
          else if (item?.outcome === 'stale') stale += 1;
          else if (item?.outcome === 'already-applied' || item?.outcome === 'already-rejected') {
            alreadyResolved += 1;
          } else failed += 1;
        } catch {
          processed += 1;
          failed += 1;
        }
      }

      const cancelled = version !== batchVersion.current;
      if (applied > 0) notifyLibraryChanged();
      const details = [`${applied} aplicada${applied === 1 ? '' : 's'}`];
      if (alreadyResolved) details.push(`${alreadyResolved} já resolvida${alreadyResolved === 1 ? '' : 's'}`);
      if (stale) details.push(`${stale} desatualizada${stale === 1 ? '' : 's'}`);
      if (failed) details.push(`${failed} com erro`);

      if (cancelled) {
        const pending = decisions.slice(processed).map(decision => decision.suggestionId);
        setSelected(new Set(pending));
        setFeedback({
          kind: 'warning',
          message: `Lote interrompido: ${details.join(', ')}. ${pending.length} item(ns) não iniciado(s) permanecem selecionados.`
        });
      } else {
        setSelected(new Set());
        setFeedback({
          kind: stale || failed ? 'warning' : 'success',
          message: `Lote concluído: ${details.join(', ')}.`
        });
      }
      await load(true);
    } finally {
      setBatching(false);
      setMutating(false);
    }
  }

  const runActive = Boolean(latestRun && !TERMINAL_RUNS.has(latestRun.status));
  const failedRun = latestRun?.status === 'failed' ? latestRun : null;
  const resolvedCount = (latestRun?.summary.applied ?? 0) + (latestRun?.summary.rejected ?? 0);
  const failedCount = latestRun?.summary.failed ?? 0;

  return (
    <section className="assistant-admin" aria-labelledby="library-assistant-title">
      <header className="assistant-admin__header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="assistant-admin__header-copy">
          <strong id="library-assistant-title">Assistente da Biblioteca</strong>
          <small>Encontre metadados melhores, revise as diferenças e decida o que aplicar.</small>
        </div>
        <div className="assistant-admin__header-actions">
          <button
            type="button"
            className="assistant-admin__help-button"
            aria-pressed={showHelp}
            onClick={() => setShowHelp(value => !value)}
          >
            Como funciona?
          </button>
          <button
            type="button"
            className="assistant-admin__refresh"
            aria-label="Atualizar Assistente da Biblioteca"
            disabled={loading || analyzing || mutating}
            onClick={() => void load()}
          >
            <RefreshCw className={loading ? 'is-spinning' : ''} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {showHelp && (
        <aside className="assistant-admin__help" role="note">
          <Sparkles />
          <div>
            <strong>O assistente só propõe alterações</strong>
            <span>Ele consulta o MusicBrainz, compara com seus dados atuais e cria sugestões. Nada é aplicado automaticamente.</span>
          </div>
        </aside>
      )}

      {feedback && (
        <div
          className={`assistant-admin__feedback is-${feedback.kind}`}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          {feedback.kind === 'success' ? <Check /> : <AlertTriangle />}
          <span>{feedback.message}</span>
        </div>
      )}

      <section className={`assistant-admin__hero${failedRun ? ' is-error' : ''}`} aria-label="Estado da análise">
        <div className="assistant-admin__hero-state">
          <div className="assistant-admin__hero-icon" aria-hidden="true">
            {runActive
              ? <LoaderCircle className="is-spinning" />
              : failedRun
                ? <AlertTriangle />
                : latestRun?.status === 'completed'
                  ? <CheckCircle2 />
                  : <Sparkles />}
          </div>
          <div className="assistant-admin__hero-copy">
            <small>{runActive ? 'Processamento atual' : 'Última análise'}</small>
            <strong>{runTitle(latestRun)}</strong>
            <span>{runDescription(latestRun)}</span>
            {runActive && (
              <div className="assistant-admin__progress" role="status" aria-label="Análise em andamento">
                <span className="assistant-admin__progress-track"><i /></span>
                <small>Processamento em lotes de 10 faixas. Consultas lentas são isoladas automaticamente.</small>
              </div>
            )}
          </div>
        </div>
        <div className="assistant-admin__hero-actions">
          <button
            type="button"
            className="primary-button"
            disabled={analyzing || mutating || runActive}
            onClick={() => void analyze()}
          >
            {analyzing || runActive ? <LoaderCircle className="is-spinning" /> : <Sparkles />}
            {analyzing || runActive
              ? 'Analisando…'
              : failedRun
                ? 'Tentar novamente'
                : 'Analisar biblioteca'}
          </button>
          {(analyzing || runActive) && (
            <button type="button" onClick={() => void cancelAnalysis()}>
              <X /> Cancelar
            </button>
          )}
        </div>
      </section>

      <dl className="assistant-admin__metrics" aria-label="Resumo da análise">
        <div>
          <dt>Sugestões</dt>
          <dd>{latestRun?.summary.total ?? suggestions.length}</dd>
          <span>Total encontrado</span>
        </div>
        <div className="is-safe">
          <dt>Seguras</dt>
          <dd>{safeSuggestions.length}</dd>
          <span>Prontas para lote</span>
        </div>
        <div>
          <dt>Revisão</dt>
          <dd>{reviewSuggestions.length}</dd>
          <span>Precisam de decisão</span>
        </div>
        <div className={failedCount > 0 ? 'is-warning' : ''}>
          <dt>Falhas</dt>
          <dd>{failedCount}</dd>
          <span>Consultas problemáticas</span>
        </div>
        <div className="is-status">
          <dt>Status</dt>
          <dd>{runStatusLabel(latestRun)}</dd>
          <span>{resolvedCount > 0 ? `${resolvedCount} resolvida${resolvedCount === 1 ? '' : 's'}` : 'Sem aplicação automática'}</span>
        </div>
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
              disabled={mutating || visibleSafeSuggestions.length === 0}
              onClick={() => setSelected(new Set(visibleSafeSuggestions.map(item => item.id)))}
            >
              Selecionar seguras
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={mutating || selected.size === 0}
              onClick={() => void applySelected()}
            >
              {mutating ? <LoaderCircle className="is-spinning" /> : <Check />}
              {batching ? 'Aplicando…' : `Aplicar selecionadas (${selected.size})`}
            </button>
            {batching && <button type="button" onClick={cancelBatch}>Cancelar lote</button>}
          </div>
        </header>

        <div className="assistant-admin__toolbar">
          <nav className="assistant-admin__filters" aria-label="Filtros das sugestões">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
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
        </div>

        <div className="assistant-admin__review-content">
          {loading ? (
            <div className="assistant-admin__empty" role="status">
              <LoaderCircle className="is-spinning" />
              <div><strong>Carregando sugestões</strong><span>Buscando o estado mais recente do assistente.</span></div>
            </div>
          ) : failedRun && suggestions.length === 0 ? (
            <div className="assistant-admin__empty">
              <AlertTriangle />
              <div>
                <strong>Nenhuma sugestão disponível deste processamento</strong>
                <span>Tente novamente pelo painel acima. Uma faixa problemática não derrubará as demais no novo fluxo.</span>
              </div>
            </div>
          ) : !latestRun ? (
            <div className="assistant-admin__empty">
              <Sparkles />
              <div>
                <strong>Ainda não há sugestões para revisar</strong>
                <span>Inicie uma análise para comparar sua biblioteca com o MusicBrainz.</span>
              </div>
            </div>
          ) : latestRun.status === 'completed' && latestRun.summary.total === 0 ? (
            <div className="assistant-admin__empty">
              <Check />
              <div>
                <strong>Nenhuma sugestão encontrada</strong>
                <span>A análise terminou sem candidatos confiáveis para alterar seus metadados.</span>
              </div>
            </div>
          ) : latestRun.status === 'stale' && visibleSuggestions.length === 0 ? (
            <div className="assistant-admin__empty">
              <AlertTriangle />
              <div>
                <strong>Análise desatualizada</strong>
                <span>A biblioteca mudou. Execute uma nova análise para continuar com dados atuais.</span>
              </div>
            </div>
          ) : visibleSuggestions.length === 0 ? (
            <div className="assistant-admin__empty">
              <Search />
              <div>
                <strong>Nenhum resultado neste filtro</strong>
                <span>Ajuste o filtro ou a busca para encontrar outras sugestões.</span>
              </div>
            </div>
          ) : (
            <div className="assistant-admin__list" aria-live="polite">
              {visibleSuggestions.map(suggestion => {
                const item = reviewMap.get(suggestion.id);
                const target = suggestion.target.capability === 'metadata' ? suggestion.target : null;
                const safe = isSafe(suggestion);
                const canDecide = Boolean(item && target && isOpen(suggestion));
                const physicalValue = target && item ? item.track.physical[target.field] : null;
                const showPhysical = physicalValue != null && physicalValue !== target?.currentValue;
                return (
                  <article key={suggestion.id} className="assistant-admin-card">
                    <div className="assistant-admin-card__topline">
                      <div className="assistant-admin-card__identity">
                        <strong>{item?.track.title ?? `Faixa ${suggestion.target.trackId}`}</strong>
                        {item && <small>{item.track.artist} · {item.track.album}</small>}
                      </div>
                      <div className="assistant-admin-card__badges">
                        <span>{statusLabel(suggestion.status)}</span>
                        <span>{confidenceLabel(suggestion.confidence)}</span>
                        <span>{suggestion.provenance.source}</span>
                      </div>
                    </div>

                    {target && (
                      <dl className="assistant-admin-card__diff">
                        <div><dt>Campo</dt><dd>{FIELD_LABELS[target.field] ?? target.field}</dd></div>
                        {showPhysical && <div><dt>Físico</dt><dd>{physicalValue || '—'}</dd></div>}
                        <div><dt>Atual efetivo</dt><dd>{target.currentValue || '—'}</dd></div>
                        <div className="is-suggested"><dt>Sugerido</dt><dd>{target.suggestedValue || '—'}</dd></div>
                      </dl>
                    )}

                    <div className="assistant-admin-card__footer">
                      <div className="assistant-admin-card__evidence">
                        <strong>Por que essa sugestão?</strong>
                        <ul>
                          {suggestion.reasonCodes.map(reason => (
                            <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>
                          ))}
                        </ul>
                      </div>
                      {canDecide && (
                        <div className="assistant-admin-card__actions">
                          {safe && (
                            <label className="assistant-admin-card__select">
                              <input
                                type="checkbox"
                                checked={selected.has(suggestion.id)}
                                onChange={event => setSelected(current => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(suggestion.id);
                                  else next.delete(suggestion.id);
                                  return next;
                                })}
                              />
                              Selecionar
                            </label>
                          )}
                          <button
                            type="button"
                            disabled={mutating}
                            onClick={() => void decideOne(suggestion, 'reject')}
                          >
                            <X /> Rejeitar
                          </button>
                          <button
                            type="button"
                            className="primary-button"
                            disabled={mutating}
                            onClick={() => void decideOne(suggestion, 'apply')}
                          >
                            <Check /> Aplicar este campo
                          </button>
                        </div>
                      )}
                    </div>

                    {suggestion.reasonCodes.includes('human-override') && (
                      <div className="assistant-admin-card__warning" role="note">
                        <AlertTriangle /> Existe uma decisão humana neste metadado. Ela nunca entra no lote seguro automaticamente.
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="assistant-admin__last-run" aria-label="Última análise registrada">
        <span className="assistant-admin__last-run-icon"><RefreshCw /></span>
        <div>
          <strong>Última análise</strong>
          <span>{latestRun ? `${runStatusLabel(latestRun)} · ${formatRunDate(latestRun)}` : 'Ainda não há análises concluídas.'}</span>
        </div>
        <button type="button" disabled={loading || analyzing || mutating} onClick={() => void load()}>
          Atualizar estado
        </button>
      </section>

      <aside className="assistant-admin__tip" role="note">
        <Sparkles />
        <div>
          <strong>Dica</strong>
          <span>O assistente usa o MusicBrainz e processa a biblioteca em lotes de 10 faixas para reduzir o impacto de consultas lentas ou instáveis.</span>
        </div>
      </aside>
    </section>
  );
}
