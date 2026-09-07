import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LibraryAssistantDecision,
  LibraryAssistantReviewItem,
  LibraryAssistantRun,
  LibraryAssistantSuggestion,
  LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  LoaderCircle,
  RefreshCw,
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
import { dispatchLibraryChanged } from '../library-events';
import '../library-assistant-admin.css';

type Props = {
  onBack: () => void;
};

type Filter = 'all' | 'open' | 'safe' | 'review' | 'stale' | 'applied' | 'rejected' | 'failed';

type Feedback = {
  kind: 'success' | 'error' | 'warning';
  message: string;
};

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'stale']);

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
  return isOpen(suggestion)
    && suggestion.confidence === 'high'
    && suggestion.conflicts.length === 0
    && !suggestion.reasonCodes.includes('human-override')
    && !suggestion.reasonCodes.includes('ambiguous-candidates')
    && !suggestion.reasonCodes.includes('source-conflict');
}

function confidenceLabel(value: LibraryAssistantSuggestion['confidence']) {
  if (value === 'high') return 'Alta confiança';
  if (value === 'medium') return 'Confiança média';
  return 'Baixa confiança';
}

function statusLabel(status: LibraryAssistantSuggestionStatus) {
  if (status === 'pending') return 'Pendente';
  if (status === 'review') return 'Revisão necessária';
  if (status === 'applied') return 'Aplicada';
  if (status === 'rejected') return 'Rejeitada';
  if (status === 'stale') return 'Desatualizada';
  return 'Falhou';
}

function delay(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
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
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const requestVersion = useRef(0);
  const analysisVersion = useRef(0);

  const latestRun = useMemo(
    () => runs.find(run => run.capability === 'metadata') ?? null,
    [runs]
  );

  const reviewMap = useMemo(
    () => new Map(reviewItems.map(item => [item.suggestion.id, item])),
    [reviewItems]
  );

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    setFeedback(current => current?.kind === 'success' ? current : null);
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
      setSuggestions(suggestionResponse.suggestions);
    } catch (error) {
      if (version !== requestVersion.current) return;
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível carregar o Assistente da Biblioteca.'
      });
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      requestVersion.current += 1;
      analysisVersion.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setSelected(new Set());
  }, [filter, latestRun?.id]);

  const safeSuggestions = useMemo(() => suggestions.filter(isSafe), [suggestions]);
  const reviewSuggestions = useMemo(
    () => suggestions.filter(item => isOpen(item) && !isSafe(item)),
    [suggestions]
  );

  const visibleSuggestions = useMemo(() => suggestions.filter(suggestion => {
    if (filter === 'all') return true;
    if (filter === 'open') return isOpen(suggestion);
    if (filter === 'safe') return isSafe(suggestion);
    if (filter === 'review') return isOpen(suggestion) && !isSafe(suggestion);
    return suggestion.status === filter;
  }), [filter, suggestions]);

  async function analyze() {
    if (analyzing || mutating) return;
    const version = ++analysisVersion.current;
    setAnalyzing(true);
    setFeedback(null);
    try {
      let run = (await startLibraryAssistantMetadataRun()).run;
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      while (!TERMINAL_RUNS.has(run.status)) {
        await delay(700);
        if (version !== analysisVersion.current) return;
        run = (await getLibraryAssistantRun(run.id)).run;
        if (version !== analysisVersion.current) return;
        setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      }
      if (run.status === 'failed') {
        setFeedback({ kind: 'error', message: run.error?.message ?? 'A análise não pôde ser concluída.' });
      } else if (run.status === 'cancelled') {
        setFeedback({ kind: 'warning', message: 'Análise cancelada. Nenhuma decisão pendente foi aplicada.' });
      } else {
        setFeedback({ kind: 'success', message: 'Análise concluída. Revise as sugestões antes de aplicar.' });
      }
      await load(true);
    } catch (error) {
      if (version !== analysisVersion.current) return;
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível iniciar a análise.'
      });
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
      const response = await decideLibraryAssistantSuggestion(decision);
      const outcome = response.result.outcome;
      if (outcome === 'applied') {
        dispatchLibraryChanged();
        setFeedback({ kind: 'success', message: 'Sugestão aplicada. A biblioteca foi atualizada sem rescan.' });
      } else if (outcome === 'rejected') {
        setFeedback({ kind: 'success', message: 'Sugestão rejeitada e preservada no histórico da análise.' });
      } else if (outcome === 'stale') {
        setFeedback({ kind: 'warning', message: response.result.message ?? 'A sugestão ficou desatualizada. Analise novamente.' });
      } else {
        setFeedback({ kind: 'error', message: response.result.message ?? 'A decisão não pôde ser concluída.' });
      }
      await load(true);
    } catch (error) {
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'A decisão não pôde ser concluída.' });
    } finally {
      setMutating(false);
    }
  }

  async function applySelected() {
    if (mutating || selected.size === 0) return;
    const chosen = suggestions.filter(item => selected.has(item.id) && isSafe(item));
    const decisions = chosen
      .map(item => decisionFor(item, 'apply'))
      .filter((item): item is LibraryAssistantDecision => Boolean(item));
    if (decisions.length === 0) {
      setFeedback({ kind: 'warning', message: 'Nenhuma sugestão segura e ainda válida está selecionada.' });
      return;
    }
    setMutating(true);
    setFeedback(null);
    try {
      const response = await decideLibraryAssistantBatch(decisions);
      if (response.summary.applied > 0) dispatchLibraryChanged();
      const parts = [`${response.summary.applied} aplicada${response.summary.applied === 1 ? '' : 's'}`];
      if (response.summary.stale > 0) parts.push(`${response.summary.stale} desatualizada${response.summary.stale === 1 ? '' : 's'}`);
      if (response.summary.failed > 0) parts.push(`${response.summary.failed} com erro`);
      setFeedback({
        kind: response.summary.failed || response.summary.stale ? 'warning' : 'success',
        message: `Lote concluído: ${parts.join(', ')}. Falhas podem ser revisadas e tentadas novamente.`
      });
      setSelected(new Set());
      await load(true);
    } catch (error) {
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'O lote não pôde ser concluído.' });
    } finally {
      setMutating(false);
    }
  }

  function selectSafeVisible() {
    setSelected(new Set(visibleSuggestions.filter(isSafe).map(item => item.id)));
  }

  const runActive = Boolean(latestRun && !TERMINAL_RUNS.has(latestRun.status));

  return (
    <section className="assistant-admin" aria-labelledby="library-assistant-title">
      <header className="assistant-admin__header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="library-assistant-title">Assistente da Biblioteca</strong>
          <small>Analise, entenda e aplique metadados com revisão humana.</small>
        </div>
        <button type="button" className="assistant-admin__refresh" disabled={loading || analyzing || mutating} onClick={() => void load()}>
          <RefreshCw className={loading ? 'is-spinning' : ''} /> Atualizar
        </button>
      </header>

      {feedback && (
        <div className={`assistant-admin__feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'success' ? <Check /> : <AlertTriangle />}
          <span>{feedback.message}</span>
        </div>
      )}

      <section className="assistant-admin__summary" aria-label="Resumo da análise">
        <div><small>Sugestões</small><strong>{latestRun?.summary.total ?? 0}</strong></div>
        <div><small>Seguras</small><strong>{safeSuggestions.length}</strong></div>
        <div><small>Precisam de revisão</small><strong>{reviewSuggestions.length}</strong></div>
        <div><small>Desatualizadas</small><strong>{latestRun?.summary.stale ?? 0}</strong></div>
        <div><small>Aplicadas</small><strong>{latestRun?.summary.applied ?? 0}</strong></div>
        <div><small>Rejeitadas</small><strong>{latestRun?.summary.rejected ?? 0}</strong></div>
      </section>

      <section className="assistant-admin__actions" aria-label="Ações do assistente">
        <button type="button" className="primary-button" disabled={analyzing || mutating || runActive} onClick={() => void analyze()}>
          {analyzing || runActive ? <LoaderCircle className="is-spinning" /> : <Sparkles />}
          {analyzing || runActive ? 'Analisando biblioteca…' : 'Analisar biblioteca'}
        </button>
        {(analyzing || runActive) && <button type="button" onClick={() => void cancelAnalysis()}>Cancelar análise</button>}
        <button type="button" disabled={mutating || safeSuggestions.length === 0} onClick={selectSafeVisible}>Selecionar seguras</button>
        <button type="button" disabled={mutating || selected.size === 0} onClick={() => void applySelected()}>
          {mutating ? <LoaderCircle className="is-spinning" /> : <Check />} Aplicar selecionadas ({selected.size})
        </button>
      </section>

      <nav className="assistant-admin__filters" aria-label="Filtros das sugestões">
        {([
          ['open', 'Abertas'],
          ['safe', 'Seguras'],
          ['review', 'Revisão'],
          ['stale', 'Desatualizadas'],
          ['applied', 'Aplicadas'],
          ['rejected', 'Rejeitadas'],
          ['failed', 'Falhas'],
          ['all', 'Todas']
        ] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </nav>

      {loading ? (
        <div className="assistant-admin__empty" role="status"><LoaderCircle className="is-spinning" /> Carregando sugestões…</div>
      ) : !latestRun ? (
        <div className="assistant-admin__empty">Nenhuma análise de metadados foi executada. Use “Analisar biblioteca” para começar.</div>
      ) : visibleSuggestions.length === 0 ? (
        <div className="assistant-admin__empty">Nenhuma sugestão neste filtro.</div>
      ) : (
        <div className="assistant-admin__list" aria-live="polite">
          {visibleSuggestions.map(suggestion => {
            const item = reviewMap.get(suggestion.id);
            const target = suggestion.target.capability === 'metadata' ? suggestion.target : null;
            const safe = isSafe(suggestion);
            const canDecide = Boolean(item && target && isOpen(suggestion));
            const checked = selected.has(suggestion.id);
            return (
              <article key={suggestion.id} className="assistant-admin-card">
                <div className="assistant-admin-card__topline">
                  {safe && canDecide ? (
                    <label className="assistant-admin-card__select">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={event => {
                          setSelected(current => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(suggestion.id); else next.delete(suggestion.id);
                            return next;
                          });
                        }}
                      />
                      Selecionar
                    </label>
                  ) : <span />}
                  <div className="assistant-admin-card__badges">
                    <span>{statusLabel(suggestion.status)}</span>
                    <span>{confidenceLabel(suggestion.confidence)}</span>
                    <span>{suggestion.provenance.source}</span>
                  </div>
                </div>

                <div className="assistant-admin-card__identity">
                  <strong>{item?.track.title ?? `Faixa ${suggestion.target.trackId}`}</strong>
                  {item && <small>{item.track.artist} · {item.track.album}</small>}
                </div>

                {target && (
                  <dl className="assistant-admin-card__diff">
                    <div><dt>Campo</dt><dd>{FIELD_LABELS[target.field] ?? target.field}</dd></div>
                    <div><dt>Atual</dt><dd>{target.currentValue || '—'}</dd></div>
                    <div><dt>Sugerido</dt><dd>{target.suggestedValue || '—'}</dd></div>
                  </dl>
                )}

                <div className="assistant-admin-card__evidence">
                  <strong>Por que o assistente sugeriu isso?</strong>
                  <ul>
                    {suggestion.reasonCodes.map(reason => <li key={reason}>{REASON_LABELS[reason] ?? reason}</li>)}
                    {suggestion.conflicts.map(conflict => <li key={`conflict-${conflict}`} className="is-warning">Conflito: {conflict}</li>)}
                  </ul>
                </div>

                {suggestion.reasonCodes.includes('human-override') && (
                  <div className="assistant-admin-card__warning" role="note">
                    <AlertTriangle /> Existe uma decisão humana neste metadado. Ela nunca entra no lote seguro automaticamente.
                  </div>
                )}

                {canDecide && (
                  <div className="assistant-admin-card__actions">
                    <button type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'reject')}><X /> Rejeitar</button>
                    <button type="button" className="primary-button" disabled={mutating} onClick={() => void decideOne(suggestion, 'apply')}><Check /> Aplicar este campo</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
