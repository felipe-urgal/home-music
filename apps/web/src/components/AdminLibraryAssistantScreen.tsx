import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isLibraryAssistantAutoApplicable,
  type LibraryAssistantDecision,
  type LibraryAssistantReviewItem,
  type LibraryAssistantRun,
  type LibraryAssistantSuggestion,
  type LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import { AlertTriangle, Check, ChevronLeft, LoaderCircle, RefreshCw, Sparkles, X } from 'lucide-react';
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
const FIELD_LABELS: Record<string, string> = { title: 'Título', artist: 'Artista', album: 'Álbum', albumArtist: 'Artista do álbum' };
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
  return value === 'high' ? 'Alta confiança' : value === 'medium' ? 'Confiança média' : 'Baixa confiança';
}

function statusLabel(status: LibraryAssistantSuggestionStatus) {
  return ({
    pending: 'Pendente', review: 'Revisão necessária', applied: 'Aplicada', rejected: 'Rejeitada', stale: 'Desatualizada', failed: 'Falhou'
  } satisfies Record<LibraryAssistantSuggestionStatus, string>)[status];
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
  const [filter, setFilter] = useState<Filter>('open');
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
  const visibleSuggestions = useMemo(() => suggestions.filter(suggestion => {
    if (filter === 'all') return true;
    if (filter === 'open') return isOpen(suggestion);
    if (filter === 'safe') return isSafe(suggestion);
    if (filter === 'review') return isOpen(suggestion) && !isSafe(suggestion);
    return suggestion.status === filter;
  }), [filter, suggestions]);
  const visibleSafeSuggestions = useMemo(() => visibleSuggestions.filter(isSafe), [visibleSuggestions]);

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const [runsResponse, reviewResponse] = await Promise.all([getLibraryAssistantRuns(), getLibraryAssistantReview()]);
      if (version !== requestVersion.current) return;
      const metadataRun = runsResponse.runs.find(run => run.capability === 'metadata') ?? null;
      const suggestionResponse = metadataRun ? await getLibraryAssistantSuggestions(metadataRun.id) : { suggestions: [] };
      if (version !== requestVersion.current) return;
      setRuns(runsResponse.runs);
      setReviewItems(reviewResponse.items);
      setSuggestions(mergeSuggestions(suggestionResponse.suggestions, reviewResponse.items, metadataRun?.id ?? null));
    } catch (error) {
      if (version === requestVersion.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível carregar o Assistente da Biblioteca.' });
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

  useEffect(() => setSelected(new Set()), [filter, latestRun?.id]);

  async function analyze() {
    if (analyzing || mutating) return;
    const version = ++analysisVersion.current;
    setAnalyzing(true);
    setFeedback(null);
    try {
      let run = (await startLibraryAssistantMetadataRun()).run;
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      while (!TERMINAL_RUNS.has(run.status)) {
        await sleep(700);
        if (version !== analysisVersion.current) return;
        run = (await getLibraryAssistantRun(run.id)).run;
        if (version !== analysisVersion.current) return;
        setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      }
      setFeedback(run.status === 'failed'
        ? { kind: 'error', message: run.error?.message ?? 'A análise não pôde ser concluída.' }
        : run.status === 'cancelled'
          ? { kind: 'warning', message: 'Análise cancelada. Nenhuma sugestão foi aplicada automaticamente.' }
          : run.summary.total === 0
            ? { kind: 'success', message: 'Análise concluída sem candidatos de metadata. Nenhuma alteração foi aplicada.' }
            : { kind: 'success', message: 'Análise concluída. Revise as sugestões antes de aplicar.' });
      await load(true);
    } catch (error) {
      if (version === analysisVersion.current) setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível iniciar a análise.' });
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
      setFeedback({ kind: 'warning', message: 'Cancelamento solicitado. Itens já concluídos não são revertidos.' });
      await load(true);
    } catch (error) {
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'Não foi possível cancelar.' });
    }
  }

  function decisionFor(suggestion: LibraryAssistantSuggestion, action: 'apply' | 'reject'): LibraryAssistantDecision | null {
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
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'A decisão não pôde ser concluída.' });
    } finally {
      setMutating(false);
    }
  }

  function cancelBatch() {
    if (!batching) return;
    batchVersion.current += 1;
    setFeedback({ kind: 'warning', message: 'Cancelamento do lote solicitado. O item em andamento pode concluir; nenhum novo item será iniciado.' });
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
          else if (item?.outcome === 'already-applied' || item?.outcome === 'already-rejected') alreadyResolved += 1;
          else failed += 1;
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
        setFeedback({ kind: 'warning', message: `Lote interrompido: ${details.join(', ')}. ${pending.length} item(ns) não iniciado(s) permanecem selecionados.` });
      } else {
        setSelected(new Set());
        setFeedback({ kind: stale || failed ? 'warning' : 'success', message: `Lote concluído: ${details.join(', ')}.` });
      }
      await load(true);
    } finally {
      setBatching(false);
      setMutating(false);
    }
  }

  const runActive = Boolean(latestRun && !TERMINAL_RUNS.has(latestRun.status));
  const persistentEmptyState = !loading && latestRun && visibleSuggestions.length === 0
    ? latestRun.status === 'failed'
      ? { role: 'alert' as const, message: `${latestRun.error?.message ?? 'A análise falhou.'}${latestRun.error?.action ? ` ${latestRun.error.action}` : ''}` }
      : latestRun.status === 'cancelled'
        ? { role: 'status' as const, message: 'Análise cancelada. Nenhuma sugestão foi aplicada automaticamente.' }
        : latestRun.status === 'completed' && latestRun.summary.total === 0
          ? { role: 'status' as const, message: 'Análise concluída sem candidatos de metadata. Nenhuma alteração foi aplicada.' }
          : latestRun.status === 'stale' && filter === 'open'
            ? { role: 'status' as const, message: 'As sugestões abertas ficaram desatualizadas. Execute uma nova análise para continuar.' }
            : null
    : null;

  return (
    <section className="assistant-admin" aria-labelledby="library-assistant-title">
      <header className="assistant-admin__header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div><strong id="library-assistant-title">Assistente da Biblioteca</strong><small>Analise, entenda e aplique metadados com revisão humana.</small></div>
        <button type="button" className="assistant-admin__refresh" disabled={loading || analyzing || mutating} onClick={() => void load()}><RefreshCw className={loading ? 'is-spinning' : ''} /> Atualizar</button>
      </header>

      {feedback && <div className={`assistant-admin__feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>{feedback.kind === 'success' ? <Check /> : <AlertTriangle />}<span>{feedback.message}</span></div>}

      <section className="assistant-admin__summary" aria-label="Resumo da análise">
        <div><small>Sugestões</small><strong>{latestRun?.summary.total ?? 0}</strong></div>
        <div><small>Seguras</small><strong>{safeSuggestions.length}</strong></div>
        <div><small>Precisam de revisão</small><strong>{reviewSuggestions.length}</strong></div>
        <div><small>Desatualizadas</small><strong>{latestRun?.summary.stale ?? 0}</strong></div>
        <div><small>Aplicadas</small><strong>{latestRun?.summary.applied ?? 0}</strong></div>
        <div><small>Rejeitadas</small><strong>{latestRun?.summary.rejected ?? 0}</strong></div>
      </section>

      <section className="assistant-admin__actions" aria-label="Ações do assistente">
        <button type="button" className="primary-button" disabled={analyzing || mutating || runActive} onClick={() => void analyze()}>{analyzing || runActive ? <LoaderCircle className="is-spinning" /> : <Sparkles />}{analyzing || runActive ? 'Analisando biblioteca…' : 'Analisar biblioteca'}</button>
        {(analyzing || runActive) && <button type="button" onClick={() => void cancelAnalysis()}>Cancelar análise</button>}
        <button type="button" disabled={mutating || visibleSafeSuggestions.length === 0} onClick={() => setSelected(new Set(visibleSafeSuggestions.map(item => item.id)))}>Selecionar seguras</button>
        <button type="button" disabled={mutating || selected.size === 0} onClick={() => void applySelected()}>{mutating ? <LoaderCircle className="is-spinning" /> : <Check />} {batching ? 'Aplicando lote…' : `Aplicar selecionadas (${selected.size})`}</button>
        {batching && <button type="button" onClick={cancelBatch}>Cancelar lote</button>}
      </section>

      <nav className="assistant-admin__filters" aria-label="Filtros das sugestões">
        {([['open', 'Abertas'], ['safe', 'Seguras'], ['review', 'Revisão'], ['stale', 'Desatualizadas'], ['applied', 'Aplicadas'], ['rejected', 'Rejeitadas'], ['failed', 'Falhas'], ['all', 'Todas']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </nav>

      {loading ? <div className="assistant-admin__empty" role="status"><LoaderCircle className="is-spinning" /> Carregando sugestões…</div>
        : !latestRun ? <div className="assistant-admin__empty">Nenhuma análise de metadados foi executada. Use “Analisar biblioteca” para começar.</div>
          : persistentEmptyState ? <div className="assistant-admin__empty" role={persistentEmptyState.role}>{persistentEmptyState.message}</div>
            : visibleSuggestions.length === 0 ? <div className="assistant-admin__empty">Nenhuma sugestão neste filtro.</div>
              : <div className="assistant-admin__list" aria-live="polite">{visibleSuggestions.map(suggestion => {
                const item = reviewMap.get(suggestion.id);
                const target = suggestion.target.capability === 'metadata' ? suggestion.target : null;
                const safe = isSafe(suggestion);
                const canDecide = Boolean(item && target && isOpen(suggestion));
                const physicalValue = target && item ? item.track.physical[target.field] : null;
                const showPhysical = physicalValue != null && physicalValue !== target?.currentValue;
                return <article key={suggestion.id} className="assistant-admin-card">
                  <div className="assistant-admin-card__topline">
                    {safe && canDecide ? <label className="assistant-admin-card__select"><input type="checkbox" checked={selected.has(suggestion.id)} onChange={event => setSelected(current => { const next = new Set(current); if (event.target.checked) next.add(suggestion.id); else next.delete(suggestion.id); return next; })} />Selecionar</label> : <span />}
                    <div className="assistant-admin-card__badges"><span>{statusLabel(suggestion.status)}</span><span>{confidenceLabel(suggestion.confidence)}</span><span>{suggestion.provenance.source}</span></div>
                  </div>
                  <div className="assistant-admin-card__identity"><strong>{item?.track.title ?? `Faixa ${suggestion.target.trackId}`}</strong>{item && <small>{item.track.artist} · {item.track.album}</small>}</div>
                  {target && <dl className="assistant-admin-card__diff"><div><dt>Campo</dt><dd>{FIELD_LABELS[target.field] ?? target.field}</dd></div>{showPhysical && <div><dt>Físico</dt><dd>{physicalValue || '—'}</dd></div>}<div><dt>Atual efetivo</dt><dd>{target.currentValue || '—'}</dd></div><div><dt>Sugerido</dt><dd>{target.suggestedValue || '—'}</dd></div></dl>}
                  <div className="assistant-admin-card__evidence"><strong>Por que o assistente sugeriu isso?</strong><ul>{suggestion.reasonCodes.map(reason => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}</ul></div>
                  {suggestion.reasonCodes.includes('human-override') && <div className="assistant-admin-card__warning" role="note"><AlertTriangle /> Existe uma decisão humana neste metadado. Ela nunca entra no lote seguro automaticamente.</div>}
                  {canDecide && <div className="assistant-admin-card__actions"><button type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'reject')}><X /> Rejeitar</button><button type="button" className="primary-button" disabled={mutating} onClick={() => void decideOne(suggestion, 'apply')}><Check /> Aplicar este campo</button></div>}
                </article>;
              })}</div>}
    </section>
  );
}
