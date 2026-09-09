import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isLibraryAssistantAutoApplicable,
  type LibraryAssistantArtworkTarget,
  type LibraryAssistantDecision,
  type LibraryAssistantDecisionResult,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReviewItem,
  type LibraryAssistantRun,
  type LibraryAssistantRunProgress,
  type LibraryAssistantSuggestion,
  type LibraryAssistantSuggestionStatus
} from '@home-music/shared/library-assistant';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Clock3,
  Info,
  LoaderCircle,
  MoreVertical,
  Music2,
  RefreshCw,
  Search,
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
  resetLibraryAssistantReview,
  startLibraryAssistantMetadataRun
} from '../library-assistant-client';
import { notifyLibraryChanged } from '../library-events';
import '../library-assistant-admin.css';
import '../library-assistant-operations.css';

type Props = { onBack: () => void };
type Filter = 'all' | 'open' | 'safe' | 'review' | 'applied' | 'rejected' | 'failed';
type Sort = 'recent' | 'oldest';
type Section = 'suggestions' | 'queue' | 'statistics' | 'settings';
type Feedback = { kind: 'success' | 'error' | 'warning'; message: string; details?: string[] };

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'stale']);
const BATCH_SIZE = 100;
const FIELD_STORAGE_KEY = 'home-music.library-assistant.visible-fields';
const METADATA_FIELDS: readonly LibraryAssistantMetadataField[] = ['title', 'artist', 'album', 'albumArtist'];
const FILTERS: readonly [Filter, string][] = [
  ['all', 'Todas'],
  ['open', 'Abertas'],
  ['safe', 'Seguras'],
  ['review', 'Revisão'],
  ['applied', 'Aplicadas'],
  ['rejected', 'Rejeitadas'],
  ['failed', 'Falhas']
];
const SECTIONS: readonly [Section, string][] = [
  ['suggestions', 'Sugestões'],
  ['queue', 'Fila'],
  ['statistics', 'Estatísticas'],
  ['settings', 'Configurações']
];
const FIELD_LABELS: Record<LibraryAssistantMetadataField, string> = {
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista do álbum'
};
const FIELD_DESCRIPTIONS: Record<LibraryAssistantMetadataField, string> = {
  title: 'Mostra sugestões que alteram o título da faixa.',
  artist: 'Mostra sugestões que alteram o artista da faixa.',
  album: 'Mostra sugestões que alteram o nome do álbum.',
  albumArtist: 'Mostra sugestões que alteram o artista do álbum.'
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

function canApplyInBatch(suggestion: LibraryAssistantSuggestion) {
  return suggestion.target.capability === 'metadata' && isOpen(suggestion);
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

function runDescription(run: LibraryAssistantRun | null): readonly [string, string?] {
  if (!run) {
    return ['Enriqueça metadados com o MusicBrainz e capas com o Cover Art Archive.', 'Nada é aplicado sem sua confirmação.'];
  }
  if (run.status === 'queued' || run.status === 'running') {
    return [
      'Enriquecendo metadados e procurando capas confiáveis.',
      'Você já pode revisar e aplicar resultados prontos enquanto o restante da biblioteca continua sendo analisado.'
    ];
  }
  if (run.status === 'failed') {
    return [run.error?.message ?? 'O processamento foi interrompido.', 'Você pode iniciar uma nova análise.'];
  }
  if (run.status === 'cancelled') {
    return ['O processamento foi cancelado.', 'Sugestões abertas desse processamento foram invalidadas.'];
  }
  if (run.status === 'stale') {
    return ['A biblioteca mudou desde esta análise.', 'Execute uma nova análise para trabalhar com dados atuais.'];
  }
  return run.summary.total === 0
    ? ['A análise terminou sem sugestões de metadata ou capa.']
    : [`${run.summary.total} sugestão${run.summary.total === 1 ? '' : 'ões'} encontrada${run.summary.total === 1 ? '' : 's'} para revisão.`];
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

function formatDuration(durationMs: number) {
  const minutes = Math.max(0, Math.round(durationMs / 60_000));
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
}

function formatRunDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function mergeSuggestions(
  history: LibraryAssistantSuggestion[],
  reviewItems: LibraryAssistantReviewItem[]
) {
  const byId = new Map(history.map(suggestion => [suggestion.id, suggestion]));
  for (const item of reviewItems) byId.set(item.suggestion.id, item.suggestion);
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
    if (suggestion.target.capability === 'artwork') return 'Capa para revisar';
    return isSafe(suggestion) ? 'Confiança alta' : 'Revisão';
  }
  return statusLabel(suggestion.status);
}

function artworkExpectedValue(target: LibraryAssistantArtworkTarget) {
  return target.currentHasCover ? target.currentCoverVersion ?? 'physical' : '';
}

function expectedCurrentValue(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability === 'metadata') return suggestion.target.currentValue;
  if (suggestion.target.capability === 'artwork') return artworkExpectedValue(suggestion.target);
  return null;
}

function capabilityLabel(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability === 'artwork') return 'Capa';
  if (suggestion.target.capability === 'metadata') return FIELD_LABELS[suggestion.target.field];
  return 'Sugestão';
}

function rowDetail(suggestion: LibraryAssistantSuggestion, item?: LibraryAssistantReviewItem) {
  if (suggestion.target.capability === 'artwork') {
    const album = item?.track.album || 'álbum identificado';
    return suggestion.target.label ?? `Capa frontal para ${album}`;
  }
  if (suggestion.target.capability === 'metadata') {
    return `${FIELD_LABELS[suggestion.target.field]}: “${suggestion.target.currentValue || '—'}” → “${suggestion.target.suggestedValue}”`;
  }
  return item?.track.album || '—';
}

function searchText(suggestion: LibraryAssistantSuggestion, item?: LibraryAssistantReviewItem) {
  const target = suggestion.target;
  return [
    item?.track.title,
    item?.track.artist,
    item?.track.album,
    target.capability === 'metadata' ? target.currentValue : null,
    target.capability === 'metadata' ? target.suggestedValue : null,
    target.capability === 'artwork' ? target.label : null,
    target.capability === 'artwork' ? target.musicBrainzReleaseId : null,
    target.capability === 'artwork' ? target.musicBrainzReleaseGroupId : null
  ].filter(Boolean).join(' ');
}

function batchOutcomeLabel(result: LibraryAssistantDecisionResult) {
  if (result.outcome === 'not-found') return 'não encontrada';
  if (result.outcome === 'unsupported') return 'não suportada';
  if (result.outcome === 'failed') return 'falhou';
  if (result.outcome === 'stale') return 'desatualizada';
  return result.outcome;
}

function AssistantTrackArtwork({ trackId }: { trackId: string }) {
  const [failed, setFailed] = useState(false);
  const url = `/api/tracks/${encodeURIComponent(trackId)}/cover`;

  useEffect(() => setFailed(false), [trackId]);

  return (
    <span className="assistant-admin-row__artwork" aria-hidden="true">
      {failed ? (
        <Music2 />
      ) : (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function AdminLibraryAssistantScreen({ onBack }: Props) {
  const [runs, setRuns] = useState<LibraryAssistantRun[]>([]);
  const [suggestions, setSuggestions] = useState<LibraryAssistantSuggestion[]>([]);
  const [reviewItems, setReviewItems] = useState<LibraryAssistantReviewItem[]>([]);
  const [progress, setProgress] = useState<LibraryAssistantRunProgress>(EMPTY_PROGRESS);
  const [section, setSection] = useState<Section>('suggestions');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [search, setSearch] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showInfo, setShowInfo] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleFields, setVisibleFields] = useState<Set<LibraryAssistantMetadataField>>(
    () => new Set(METADATA_FIELDS)
  );
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [batching, setBatching] = useState(false);
  const [confirmReviewCount, setConfirmReviewCount] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const requestVersion = useRef(0);

  const latestRun = useMemo(() => runs.find(run => run.capability === 'metadata') ?? null, [runs]);
  const metadataRuns = useMemo(() => runs.filter(run => run.capability === 'metadata'), [runs]);
  const runActive = Boolean(latestRun && !TERMINAL_RUNS.has(latestRun.status));
  const reviewMap = useMemo(() => new Map(reviewItems.map(item => [item.suggestion.id, item])), [reviewItems]);
  const safeSuggestions = useMemo(() => suggestions.filter(isSafe), [suggestions]);
  const reviewSuggestions = useMemo(() => suggestions.filter(item => isOpen(item) && !isSafe(item)), [suggestions]);
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');

  const visibleSuggestions = useMemo(() => {
    const filtered = suggestions.filter(suggestion => {
      if (suggestion.target.capability === 'metadata' && !visibleFields.has(suggestion.target.field)) return false;
      if (filter !== 'all') {
        if (filter === 'open' && !isOpen(suggestion)) return false;
        if (filter === 'safe' && !isSafe(suggestion)) return false;
        if (filter === 'review' && (!isOpen(suggestion) || isSafe(suggestion))) return false;
        if (!['open', 'safe', 'review'].includes(filter) && suggestion.status !== filter) return false;
      }
      if (!normalizedSearch) return true;
      return searchText(suggestion, reviewMap.get(suggestion.id)).toLocaleLowerCase('pt-BR').includes(normalizedSearch);
    });
    return filtered.sort((left, right) => {
      const created = left.createdAt.localeCompare(right.createdAt);
      const stable = created || left.id.localeCompare(right.id);
      return sort === 'recent' ? -stable : stable;
    });
  }, [filter, normalizedSearch, reviewMap, sort, suggestions, visibleFields]);

  const visibleSafeSuggestions = useMemo(
    () => visibleSuggestions.filter(item => canApplyInBatch(item) && isSafe(item) && reviewMap.has(item.id)),
    [reviewMap, visibleSuggestions]
  );
  const visibleActionableSuggestions = useMemo(
    () => visibleSuggestions.filter(item => canApplyInBatch(item) && reviewMap.has(item.id)),
    [reviewMap, visibleSuggestions]
  );

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
      setSuggestions(mergeSuggestions(suggestionResponse.suggestions, reviewResponse.items));
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
    try {
      const stored = window.localStorage.getItem(FIELD_STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) as unknown : null;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((field): field is LibraryAssistantMetadataField => (
          typeof field === 'string' && METADATA_FIELDS.includes(field as LibraryAssistantMetadataField)
        ));
        if (valid.length > 0) setVisibleFields(new Set(valid));
      }
    } catch {
      // Preferências locais são opcionais; defaults seguros permanecem ativos.
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

  useEffect(() => setSelected(new Set()), [filter, latestRun?.id, search, visibleFields]);

  useEffect(() => {
    if (confirmReviewCount === 0 && !confirmReset) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setConfirmReviewCount(0);
      setConfirmReset(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [confirmReset, confirmReviewCount]);

  async function analyze(full = false) {
    if (analyzing || mutating || runActive) return;
    setAnalyzing(true);
    setFeedback(null);
    try {
      const run = (await startLibraryAssistantMetadataRun({ full })).run;
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

  async function resetAndAnalyze() {
    if (analyzing || mutating || runActive) return;
    setConfirmReset(false);
    setAnalyzing(true);
    setMutating(true);
    setFeedback(null);
    let invalidated: number | null = null;
    try {
      invalidated = (await resetLibraryAssistantReview()).invalidated;
      const run = (await startLibraryAssistantMetadataRun({ full: true })).run;
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)]);
      setProgress(EMPTY_PROGRESS);
      setSuggestions([]);
      setReviewItems([]);
      setSelected(new Set());
      setFeedback({
        kind: 'success',
        message: `${invalidated.toLocaleString('pt-BR')} sugestão${invalidated === 1 ? '' : 'ões'} aberta${invalidated === 1 ? '' : 's'} descartada${invalidated === 1 ? '' : 's'}. Nova análise completa iniciada.`
      });
      await load(true);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
      setFeedback({
        kind: 'error',
        message: invalidated == null
          ? reason
          : `As sugestões abertas foram limpas, mas a nova análise não iniciou: ${reason}`
      });
      await load(true);
    } finally {
      setMutating(false);
      setAnalyzing(false);
    }
  }

  async function cancelAnalysis() {
    const run = runs.find(item => item.capability === 'metadata' && !TERMINAL_RUNS.has(item.status));
    if (!run) return;
    setMutating(true);
    try {
      await cancelLibraryAssistantRun(run.id);
      setFeedback({
        kind: 'warning',
        message: 'Análise cancelada. Sugestões abertas desse processamento foram invalidadas.'
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível cancelar.'
      });
    } finally {
      setMutating(false);
    }
  }

  function decisionFor(
    suggestion: LibraryAssistantSuggestion,
    action: 'apply' | 'reject'
  ): LibraryAssistantDecision | null {
    const item = reviewMap.get(suggestion.id);
    const expected = expectedCurrentValue(suggestion);
    if (!item || expected == null) return null;
    return {
      runId: suggestion.runId,
      suggestionId: suggestion.id,
      action,
      expectedLibraryRevision: item.runLibraryRevision,
      expectedCurrentValue: expected
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
          message: suggestion.target.capability === 'artwork'
            ? 'Capa aplicada pelo override existente.'
            : 'Sugestão aplicada. A biblioteca foi atualizada sem rescan.'
        });
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

  async function applySelected(reviewConfirmed = false) {
    if (mutating) return;
    const chosen = suggestions.filter(item => (
      selected.has(item.id)
      && canApplyInBatch(item)
      && reviewMap.has(item.id)
    ));
    const decisions = chosen
      .map(item => decisionFor(item, 'apply'))
      .filter((item): item is LibraryAssistantDecision => Boolean(item));
    if (decisions.length === 0) return;

    const reviewCount = chosen.filter(item => !isSafe(item)).length;
    if (reviewCount > 0 && !reviewConfirmed) {
      setConfirmReviewCount(reviewCount);
      return;
    }

    setConfirmReviewCount(0);
    setMutating(true);
    setBatching(true);
    setFeedback(null);

    let applied = 0;
    let stale = 0;
    let alreadyResolved = 0;
    let notFound = 0;
    let unsupported = 0;
    let failed = 0;
    const detailCounts = new Map<string, number>();

    const addDetail = (message: string) => {
      detailCounts.set(message, (detailCounts.get(message) ?? 0) + 1);
    };

    try {
      for (let offset = 0; offset < decisions.length; offset += BATCH_SIZE) {
        const chunk = decisions.slice(offset, offset + BATCH_SIZE);
        try {
          const response = await decideLibraryAssistantBatch(chunk, { confirmReview: reviewCount > 0 });
          for (const result of response.results) {
            if (result.outcome === 'applied') applied += 1;
            else if (result.outcome === 'stale') stale += 1;
            else if (result.outcome === 'already-applied' || result.outcome === 'already-rejected') alreadyResolved += 1;
            else if (result.outcome === 'not-found') notFound += 1;
            else if (result.outcome === 'unsupported') unsupported += 1;
            else failed += 1;
            if (result.message && result.outcome !== 'applied') {
              addDetail(`${batchOutcomeLabel(result)}: ${result.message}`);
            }
          }
        } catch (error) {
          failed += chunk.length;
          addDetail(error instanceof Error ? error.message : 'Falha ao enviar um bloco de decisões.');
        }
      }

      if (applied > 0) notifyLibraryChanged();
      const parts = [`${applied} aplicada${applied === 1 ? '' : 's'}`];
      if (alreadyResolved) parts.push(`${alreadyResolved} já resolvida${alreadyResolved === 1 ? '' : 's'}`);
      if (stale) parts.push(`${stale} desatualizada${stale === 1 ? '' : 's'}`);
      if (notFound) parts.push(`${notFound} não encontrada${notFound === 1 ? '' : 's'}`);
      if (unsupported) parts.push(`${unsupported} não suportada${unsupported === 1 ? '' : 's'}`);
      if (failed) parts.push(`${failed} com erro`);
      const details = [...detailCounts.entries()].map(([message, count]) => (
        count > 1 ? `${count}× ${message}` : message
      ));
      setSelected(new Set());
      setFeedback({
        kind: stale || notFound || unsupported || failed ? 'warning' : 'success',
        message: `Lote concluído: ${parts.join(', ')}.`,
        details: details.length > 0 ? details : undefined
      });
      await load(true);
    } finally {
      setBatching(false);
      setMutating(false);
    }
  }

  function toggleVisibleField(field: LibraryAssistantMetadataField, checked: boolean) {
    setVisibleFields(current => {
      const next = new Set(current);
      if (checked) next.add(field);
      else if (next.size > 1) next.delete(field);
      try {
        window.localStorage.setItem(FIELD_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Persistência local é opcional.
      }
      return next;
    });
  }

  const totalTracks = progress.total;
  const processedTracks = Math.min(progress.processed, totalTracks);
  const progressPercent = totalTracks > 0
    ? Math.min(processedTracks < totalTracks ? 99 : 100, Math.round((processedTracks / totalTracks) * 100))
    : 0;
  const pendingTracks = progress.pending + progress.processing;
  const queueFailureCount = progress.failed;
  const suggestionFailureCount = latestRun?.summary.failed ?? 0;
  const failedCount = Math.max(queueFailureCount, suggestionFailureCount);
  const failedRun = latestRun?.status === 'failed';
  const noIncrementalChanges = latestRun?.status === 'completed' && totalTracks === 0 && runs.length > 1;
  const description = noIncrementalChanges
    ? [
        'Nenhuma faixa nova ou alterada precisou ser analisada.',
        'Use “Limpar e reanalisar tudo” somente quando quiser descartar as sugestões abertas e refazer a análise completa.'
      ] as const
    : runDescription(latestRun);
  const observed = progress.metrics;
  const cacheQueries = observed ? observed.cacheHits + observed.cacheMisses : 0;
  const cachePercent = observed && cacheQueries > 0
    ? Math.round((observed.cacheHits / cacheQueries) * 100)
    : 0;
  const progressDiagnostics = observed && latestRun ? [
    `${observed.tracksPerSecond.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} faixa/s`,
    runActive
      ? observed.etaMs == null ? 'estimando tempo restante' : `~${formatDuration(observed.etaMs)} restantes`
      : `${formatDuration(observed.elapsedMs)} no total`,
    `${observed.externalRequests.toLocaleString('pt-BR')} consultas externas`,
    cacheQueries > 0 ? `${cachePercent}% via cache` : null,
    observed.rateLimitWaitMs > 0 ? `${formatDuration(observed.rateLimitWaitMs)} aguardando limite` : null,
    observed.retriesTotal > 0 ? `${observed.retriesTotal.toLocaleString('pt-BR')} retries` : null
  ].filter((value): value is string => Boolean(value)).join(' · ') : null;

  return (
    <section className="assistant-admin" aria-labelledby="library-assistant-title">
      <header className="assistant-admin__header">
        <button className="assistant-admin__back" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <strong id="library-assistant-title" className="assistant-admin__title">Assistente da Biblioteca</strong>
        <div className="assistant-admin__header-actions">
          <button
            type="button"
            className="assistant-admin__header-button"
            aria-pressed={showHelp}
            onClick={() => setShowHelp(value => !value)}
          >
            Como funciona?
          </button>
          <button
            type="button"
            className="assistant-admin__header-button"
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
          <Info />
          <div>
            <strong>O assistente só propõe alterações</strong>
            <span>“Analisar mudanças” processa faixas novas, alteradas ou com falha anterior. Resultados já processados podem ser revisados e aplicados sem esperar a análise terminar; metadados em Revisão ainda exigem confirmação explícita e capas continuam com aplicação individual.</span>
          </div>
        </aside>
      )}

      {feedback && (
        <div className={`assistant-admin__feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'success' ? <Check /> : <AlertTriangle />}
          <span>{feedback.message}</span>
          {feedback.details && (
            <details>
              <summary>Ver detalhes</summary>
              <ul>
                {feedback.details.map(detail => <li key={detail}>{detail}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <section className={`assistant-admin__hero${failedRun ? ' is-error' : ''}`} aria-label="Estado da análise">
        <div className="assistant-admin__hero-main">
          <div className="assistant-admin__hero-icon" aria-hidden="true"><Music2 /></div>
          <div className="assistant-admin__hero-copy">
            <strong>{runTitle(latestRun)}</strong>
            <span>{description[0]}</span>
            {description[1] && <span>{description[1]}</span>}
            {progressDiagnostics && <span>{progressDiagnostics}</span>}
          </div>
          <span className={`assistant-admin__run-badge is-${latestRun?.status ?? 'idle'}`}>
            {(runActive || latestRun?.status === 'completed') && <CheckCircle2 />}
            {latestRun?.status === 'failed' && <XCircle />}
            {latestRun?.status === 'cancelled' && <X />}
            {runStatusLabel(latestRun)}
          </span>
        </div>

        <div className="assistant-admin__progress-block">
          <div className="assistant-admin__progress-heading">
            <strong>
              {processedTracks.toLocaleString('pt-BR')}
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
            <div className="is-found"><CheckCircle2 /><dd>{progress.matched.toLocaleString('pt-BR')}</dd><dt>Encontradas</dt></div>
            <div className="is-pending"><Clock3 /><dd>{pendingTracks.toLocaleString('pt-BR')}</dd><dt>Pendentes</dt></div>
            <div className="is-retry"><AlertTriangle /><dd>{progress.retry.toLocaleString('pt-BR')}</dd><dt>Em retry</dt></div>
            <div className="is-empty"><XCircle /><dd>{progress.noMatch.toLocaleString('pt-BR')}</dd><dt>Sem resultado</dt></div>
          </dl>
          {runActive ? (
            <button className="assistant-admin__danger-button" type="button" disabled={mutating} onClick={() => void cancelAnalysis()}>
              <X /> Cancelar análise
            </button>
          ) : (
            <div className="assistant-admin__hero-actions">
              {latestRun && (
                <button
                  className="assistant-admin__secondary-button"
                  type="button"
                  disabled={analyzing || mutating}
                  onClick={() => setConfirmReset(true)}
                >
                  <RefreshCw /> Limpar e reanalisar tudo
                </button>
              )}
              <button
                className="assistant-admin__primary-button"
                type="button"
                disabled={analyzing || mutating}
                onClick={() => void analyze(false)}
              >
                {analyzing ? <LoaderCircle className="is-spinning" /> : <Sparkles />}
                {latestRun ? 'Analisar mudanças' : 'Analisar biblioteca'}
              </button>
            </div>
          )}
        </div>
      </section>

      <nav className="assistant-admin__sections" aria-label="Seções do Assistente da Biblioteca">
        {SECTIONS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={section === value ? 'is-active' : undefined}
            aria-current={section === value ? 'page' : undefined}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === 'suggestions' && (
        <>
          <dl className="assistant-admin__metrics" aria-label="Resumo das sugestões">
            <div className="is-suggestions"><Music2 /><dt>Sugestões</dt><dd>{suggestions.length}</dd></div>
            <div className="is-safe"><ShieldCheck /><dt>Seguras</dt><dd>{safeSuggestions.length}</dd></div>
            <div className="is-review"><AlertTriangle /><dt>Revisão</dt><dd>{reviewSuggestions.length}</dd></div>
            <div className="is-failed"><XCircle /><dt>Falhas</dt><dd>{failedCount}</dd></div>
          </dl>

          <section className="assistant-admin__review" aria-labelledby="assistant-review-title">
            <header className="assistant-admin__review-heading">
              <div>
                <strong id="assistant-review-title">Sugestões de metadados e capas</strong>
                <small>Metadados podem ser aplicados em lote; capas externas continuam com revisão e aplicação individual.</small>
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
                  className="assistant-admin__secondary-button"
                  disabled={mutating || visibleActionableSuggestions.length === 0}
                  onClick={() => setSelected(new Set(visibleActionableSuggestions.map(item => item.id)))}
                >
                  Selecionar visíveis
                </button>
                <button
                  type="button"
                  className="assistant-admin__primary-button assistant-admin__apply-button"
                  disabled={mutating || selected.size === 0}
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
              <div className="assistant-admin__controls">
                <label className="assistant-admin__search">
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar por artista, álbum, faixa ou capa…"
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
                  <div><strong>Ainda não há sugestões para revisar</strong><span>Inicie uma análise para comparar sua biblioteca com o MusicBrainz e o Cover Art Archive.</span></div>
                </div>
              ) : latestRun.status === 'completed' && latestRun.summary.total === 0 && suggestions.length === 0 ? (
                <div className="assistant-admin__empty">
                  <Check />
                  <div>
                    <strong>{totalTracks === 0 ? 'Biblioteca já está em dia' : 'Nenhuma sugestão encontrada'}</strong>
                    <span>{totalTracks === 0 ? 'Nenhuma faixa nova, alterada ou pendente precisou ser reanalisada.' : 'A análise terminou sem candidatos de metadata ou capa.'}</span>
                  </div>
                </div>
              ) : visibleSuggestions.length === 0 ? (
                <div className="assistant-admin__empty">
                  {runActive ? <LoaderCircle className="is-spinning" /> : <Search />}
                  <div>
                    <strong>{runActive ? 'Aguardando as próximas sugestões' : 'Nenhum resultado neste filtro'}</strong>
                    <span>{runActive ? 'Os resultados aparecerão aqui conforme cada faixa for processada.' : 'Ajuste filtros, busca ou campos visíveis nas Configurações.'}</span>
                  </div>
                </div>
              ) : (
                <div className="assistant-admin__list" aria-live="polite">
                  {visibleSuggestions.map(suggestion => {
                    const item = reviewMap.get(suggestion.id);
                    const safe = isSafe(suggestion);
                    const canDecide = Boolean(item && expectedCurrentValue(suggestion) != null && isOpen(suggestion));
                    const selectable = Boolean(item && canApplyInBatch(suggestion));
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
                        <AssistantTrackArtwork trackId={suggestion.target.trackId} />
                        <div className="assistant-admin-row__identity">
                          <strong>{item?.track.artist ?? 'Faixa da biblioteca'}</strong>
                          <span className="assistant-admin-row__title">{item?.track.title ?? `Faixa ${suggestion.target.trackId}`}</span>
                          <span className="assistant-admin-row__album">{rowDetail(suggestion, item)}</span>
                          <span className="assistant-admin__sr-only">
                            {capabilityLabel(suggestion)} {rowDetail(suggestion, item)}
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
                  <span>Você pode revisar os resultados que já apareceram; a tela continua atualizando a análise automaticamente.</span>
                </div>
                <button type="button" onClick={() => setShowInfo(false)}>Entendi</button>
              </aside>
            )}
          </section>
        </>
      )}

      {section === 'queue' && (
        <section className="assistant-admin__operations-panel" aria-labelledby="assistant-queue-title">
          <header className="assistant-admin__operations-heading">
            <div>
              <strong id="assistant-queue-title">Fila de processamento</strong>
              <small>Estado operacional da análise mais recente. Falhas entram novamente no próximo “Analisar mudanças”.</small>
            </div>
            <span className={`assistant-admin__run-badge is-${latestRun?.status ?? 'idle'}`}>{runStatusLabel(latestRun)}</span>
          </header>
          <dl className="assistant-admin__operations-grid">
            <div><dt>Processando</dt><dd>{progress.processing.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Pendentes</dt><dd>{progress.pending.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Em retry</dt><dd>{progress.retry.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Encontradas</dt><dd>{progress.matched.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Sem resultado</dt><dd>{progress.noMatch.toLocaleString('pt-BR')}</dd></div>
            <div><dt>Falhas</dt><dd>{progress.failed.toLocaleString('pt-BR')}</dd></div>
          </dl>
          {!latestRun ? (
            <p className="assistant-admin__operations-copy">Ainda não há uma análise para acompanhar.</p>
          ) : (
            <p className="assistant-admin__operations-copy">
              {processedTracks.toLocaleString('pt-BR')} de {totalTracks.toLocaleString('pt-BR')} itens concluídos nesta execução.
              {observed?.etaMs != null && runActive ? ` Estimativa restante: ${formatDuration(observed.etaMs)}.` : ''}
            </p>
          )}
          <div className="assistant-admin__operations-actions">
            {runActive ? (
              <button className="assistant-admin__danger-button" type="button" disabled={mutating} onClick={() => void cancelAnalysis()}>
                <X /> Cancelar análise
              </button>
            ) : (
              <button
                className="assistant-admin__primary-button"
                type="button"
                disabled={mutating || analyzing}
                onClick={() => void analyze(false)}
              >
                <RefreshCw /> {progress.failed > 0 ? 'Tentar falhas novamente' : 'Analisar mudanças'}
              </button>
            )}
          </div>
        </section>
      )}

      {section === 'statistics' && (
        <section className="assistant-admin__operations-panel" aria-labelledby="assistant-statistics-title">
          <header className="assistant-admin__operations-heading">
            <div>
              <strong id="assistant-statistics-title">Estatísticas</strong>
              <small>Métricas da análise mais recente e histórico das últimas execuções de metadados.</small>
            </div>
          </header>
          <dl className="assistant-admin__operations-grid">
            <div><dt>Tempo</dt><dd>{observed ? formatDuration(observed.elapsedMs) : '—'}</dd></div>
            <div><dt>Velocidade</dt><dd>{observed ? observed.tracksPerSecond.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—'}</dd></div>
            <div><dt>Consultas externas</dt><dd>{observed ? observed.externalRequests.toLocaleString('pt-BR') : '—'}</dd></div>
            <div><dt>Cache</dt><dd>{cacheQueries > 0 ? `${cachePercent}%` : '—'}</dd></div>
            <div><dt>Retries</dt><dd>{observed ? observed.retriesTotal.toLocaleString('pt-BR') : '—'}</dd></div>
            <div><dt>Espera por limite</dt><dd>{observed ? formatDuration(observed.rateLimitWaitMs) : '—'}</dd></div>
          </dl>
          <div>
            <strong>Últimas análises</strong>
            {metadataRuns.length === 0 ? (
              <p className="assistant-admin__operations-copy">Nenhuma execução registrada.</p>
            ) : (
              <ul className="assistant-admin__history">
                {metadataRuns.slice(0, 8).map(run => (
                  <li key={run.id}>
                    <span>{formatRunDate(run.createdAt)}</span>
                    <span className="assistant-admin__history-status">{runStatusLabel(run)}</span>
                    <span>{run.summary.total.toLocaleString('pt-BR')} sugestões</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {section === 'settings' && (
        <section className="assistant-admin__operations-panel" aria-labelledby="assistant-settings-title">
          <header className="assistant-admin__operations-heading">
            <div>
              <strong id="assistant-settings-title">Configurações</strong>
              <small>Preferências simples da revisão. Segurança, stale protection e confirmação de itens em Revisão não podem ser desativadas.</small>
            </div>
          </header>
          <div className="assistant-admin__settings">
            <strong>Campos de metadados exibidos</strong>
            <p className="assistant-admin__settings-note">Esta preferência controla apenas sugestões textuais; sugestões de capa permanecem visíveis e a análise continua verificando todos os campos suportados.</p>
            {METADATA_FIELDS.map(field => (
              <label key={field} className="assistant-admin__settings-field">
                <input
                  type="checkbox"
                  checked={visibleFields.has(field)}
                  disabled={visibleFields.has(field) && visibleFields.size === 1}
                  onChange={event => toggleVisibleField(field, event.target.checked)}
                />
                <span>
                  <strong>{FIELD_LABELS[field]}</strong>
                  <small>{FIELD_DESCRIPTIONS[field]}</small>
                </span>
              </label>
            ))}
          </div>
          <div className="assistant-admin__settings">
            <strong>Comportamento da análise</strong>
            <p className="assistant-admin__settings-note">Use “Analisar mudanças” no dia a dia: itens com falha anterior, faixas novas e alterações voltam para a fila. “Limpar e reanalisar tudo” invalida somente sugestões abertas de metadados e capas; Aplicadas e Rejeitadas permanecem no histórico.</p>
          </div>
        </section>
      )}

      {confirmReviewCount > 0 && (
        <div className="assistant-admin__confirm-backdrop">
          <section className="assistant-admin__confirm" role="dialog" aria-modal="true" aria-labelledby="assistant-confirm-review-title">
            <h2 id="assistant-confirm-review-title">Aplicar sugestões em Revisão?</h2>
            <p>
              A seleção contém {confirmReviewCount.toLocaleString('pt-BR')} sugestão{confirmReviewCount === 1 ? '' : 'ões'} de metadados que exige{confirmReviewCount === 1 ? '' : 'm'} revisão humana. O servidor continuará validando metadata atual, revisão da biblioteca e overrides antes de aplicar cada item.
            </p>
            <div className="assistant-admin__confirm-actions">
              <button autoFocus className="assistant-admin__secondary-button" type="button" onClick={() => setConfirmReviewCount(0)}>Cancelar</button>
              <button className="assistant-admin__primary-button" type="button" onClick={() => void applySelected(true)}><Check /> Confirmar lote</button>
            </div>
          </section>
        </div>
      )}

      {confirmReset && (
        <div className="assistant-admin__confirm-backdrop">
          <section className="assistant-admin__confirm" role="dialog" aria-modal="true" aria-labelledby="assistant-confirm-reset-title">
            <h2 id="assistant-confirm-reset-title">Limpar e reanalisar tudo?</h2>
            <p>As sugestões abertas de metadados e capas serão marcadas como desatualizadas e uma nova análise completa será iniciada. Aplicadas, Rejeitadas e o histórico das execuções serão preservados.</p>
            <div className="assistant-admin__confirm-actions">
              <button autoFocus className="assistant-admin__secondary-button" type="button" onClick={() => setConfirmReset(false)}>Cancelar</button>
              <button className="assistant-admin__danger-button" type="button" onClick={() => void resetAndAnalyze()}><RefreshCw /> Limpar e reanalisar</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}