import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminTrack } from '@home-music/shared';
import {
  DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY,
  isLibraryAssistantAutoApplicable,
  type LibraryAssistantCapability,
  type LibraryAssistantDecision,
  type LibraryAssistantReviewItem,
  type LibraryAssistantReviewMode,
  type LibraryAssistantReviewPolicy,
  type LibraryAssistantReviewPolicyKey,
  type LibraryAssistantRun,
  type LibraryAssistantRunProgress,
  type LibraryAssistantSuggestion,
  type LibraryAssistantTrackAnalysisState
} from '@home-music/shared/library-assistant';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Fingerprint,
  HelpCircle,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Music2,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  XCircle
} from 'lucide-react';
import { listAdminTracks } from '../admin-tracks-client';
import {
  cancelSingleLibraryAssistantRun,
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  fingerprintLibraryAssistantSuggestion,
  getLibraryAssistantAutonomy,
  getLibraryAssistantFingerprintStatus,
  getLibraryAssistantReview,
  getLibraryAssistantReviewPolicy,
  getLibraryAssistantRunProgress,
  getLibraryAssistantRuns,
  getLibraryAssistantRunTracks,
  getLibraryAssistantSuggestions,
  startLibraryAssistantRun,
  updateLibraryAssistantAutonomy,
  updateLibraryAssistantReviewPolicy,
  type LibraryAssistantAutonomyState,
  type LibraryAssistantFingerprintStatus
} from '../library-assistant-client';
import { notifyLibraryChanged } from '../library-events';
import '../library-assistant-tabs.css';

type Props = {
  onBack: () => void;
  onOpenLocalLyrics?: () => void;
};

type CapabilityTab = LibraryAssistantCapability;
type TrackVisualStatus = 'review' | 'suggestion' | 'ok' | 'pending' | 'failed' | 'not-analyzed';
type TrackStatusFilter = 'all' | TrackVisualStatus;
type Feedback = { kind: 'success' | 'error' | 'warning'; message: string };
type PolicyRow = {
  key: LibraryAssistantReviewPolicyKey;
  label: string;
  description: string;
  allowBulk: boolean;
};

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'stale']);
const PAGE_SIZE = 50;
const CAPABILITY_TABS: readonly CapabilityTab[] = ['metadata', 'artwork', 'lyrics'];
const POLICY_MODES: readonly [LibraryAssistantReviewMode, string][] = [
  ['ignore', 'Ocultar'],
  ['review', 'Revisar individualmente'],
  ['bulk', 'Permitir lote seguro']
];
const POLICY_ROWS: readonly PolicyRow[] = [
  {
    key: 'title',
    label: 'Título',
    description: 'Sugestões que alteram o título da faixa.',
    allowBulk: true
  },
  {
    key: 'artist',
    label: 'Artista',
    description: 'Sugestões que alteram o artista da faixa.',
    allowBulk: true
  },
  {
    key: 'album',
    label: 'Álbum',
    description: 'Sugestões que alteram o nome do álbum.',
    allowBulk: true
  },
  {
    key: 'albumArtist',
    label: 'Artista do álbum',
    description: 'Sugestões que alteram o artista do álbum.',
    allowBulk: true
  },
  {
    key: 'artwork',
    label: 'Capas',
    description: 'Capas continuam com aplicação individual após conferir a imagem.',
    allowBulk: false
  },
  {
    key: 'lyrics',
    label: 'Letras',
    description: 'Letras encontradas para faixas sem uma letra efetiva.',
    allowBulk: true
  }
];

function capabilityLabel(capability: CapabilityTab) {
  if (capability === 'metadata') return 'Metadados';
  if (capability === 'artwork') return 'Capas';
  return 'Letras';
}

function capabilityDescription(capability: CapabilityTab) {
  if (capability === 'metadata') {
    return 'Analisa título, artista, álbum e artista do álbum e destaca apenas o que precisa da sua atenção.';
  }
  if (capability === 'artwork') {
    return 'Verifica a biblioteca inteira e procura capas apenas onde elas estão ausentes.';
  }
  return 'Verifica letras disponíveis e sinaliza resultados que podem ser aplicados ou revisados.';
}

function analyzeButtonLabel(capability: CapabilityTab, run: LibraryAssistantRun | null) {
  const label = capability === 'metadata' ? 'metadados' : capability === 'artwork' ? 'capas' : 'letras';
  return run ? `Analisar ${label} novamente` : `Analisar ${label}`;
}

function isOpen(suggestion: LibraryAssistantSuggestion) {
  return suggestion.status === 'pending' || suggestion.status === 'review';
}

function policyModeForSuggestion(
  policy: LibraryAssistantReviewPolicy,
  suggestion: LibraryAssistantSuggestion
): LibraryAssistantReviewMode {
  if (suggestion.target.capability === 'metadata') return policy[suggestion.target.field];
  if (suggestion.target.capability === 'artwork') return policy.artwork;
  return policy.lyrics;
}

function isVisibleOpenSuggestion(
  policy: LibraryAssistantReviewPolicy,
  suggestion: LibraryAssistantSuggestion
) {
  return isOpen(suggestion) && policyModeForSuggestion(policy, suggestion) !== 'ignore';
}

function expectedCurrentValue(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability === 'metadata') return suggestion.target.currentValue;
  if (suggestion.target.capability === 'lyrics') return suggestion.target.currentValue;
  return suggestion.target.currentHasCover
    ? suggestion.target.currentCoverVersion ?? 'physical'
    : '';
}

function runIsActive(run: LibraryAssistantRun | null) {
  return Boolean(run && !TERMINAL_RUNS.has(run.status));
}

function formatRunDate(run: LibraryAssistantRun | null) {
  if (!run) return 'Ainda não analisado';
  const value = run.finishedAt ?? run.createdAt;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function trackCoverUrl(trackId: string) {
  return `/api/tracks/${encodeURIComponent(trackId)}/cover`;
}

function suggestionArtworkUrl(suggestion: LibraryAssistantSuggestion) {
  return `/api/admin/library-assistant/runs/${encodeURIComponent(suggestion.runId)}/suggestions/${encodeURIComponent(suggestion.id)}/artwork-preview`;
}

function mergeSuggestions(
  current: LibraryAssistantSuggestion[],
  review: LibraryAssistantReviewItem[]
) {
  const byId = new Map(current.map(item => [item.id, item]));
  for (const item of review) byId.set(item.suggestion.id, item.suggestion);
  return [...byId.values()];
}

function latestRunFor(
  runs: readonly LibraryAssistantRun[],
  capability: CapabilityTab
) {
  return runs.find(run => run.capability === capability && !TERMINAL_RUNS.has(run.status))
    ?? runs.find(run => run.capability === capability)
    ?? null;
}

function visualStatus(
  track: AdminTrack,
  capability: CapabilityTab,
  state: LibraryAssistantTrackAnalysisState | null,
  suggestions: readonly LibraryAssistantSuggestion[]
): TrackVisualStatus {
  const open = suggestions.filter(isOpen);
  if (open.some(item => !isLibraryAssistantAutoApplicable(item))) return 'review';
  if (open.some(isLibraryAssistantAutoApplicable)) return 'suggestion';

  if (capability === 'artwork' && track.hasCover) return 'ok';
  if (!state) return 'not-analyzed';

  if (state.status === 'processing' || state.status === 'pending' || state.status === 'retry') {
    return 'pending';
  }
  if (state.status === 'failed') return 'failed';
  return 'ok';
}

function statusLabel(status: TrackVisualStatus, work?: LibraryAssistantTrackAnalysisState | null) {
  if (status === 'review') return 'Revisar';
  if (status === 'suggestion') return 'Sugestão';
  if (status === 'ok') return 'OK';
  if (status === 'failed') return 'Falha';
  if (status === 'not-analyzed') return 'Não analisado';
  if (work?.status === 'retry') return 'Nova tentativa';
  if (work?.status === 'processing') return 'Analisando';
  return 'Na fila';
}

function suggestionTitle(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability === 'metadata') {
    const labels = {
      title: 'Título',
      artist: 'Artista',
      album: 'Álbum',
      albumArtist: 'Artista do álbum'
    } as const;
    return labels[suggestion.target.field];
  }
  if (suggestion.target.capability === 'artwork') return 'Capa';
  return suggestion.target.synchronized ? 'Letra sincronizada' : 'Letra';
}

function TrackArtwork({ track }: { track: AdminTrack }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track.id, track.coverVersion]);

  return (
    <span className="assistant-tabs__artwork" aria-hidden="true">
      {track.hasCover && !failed
        ? <img src={trackCoverUrl(track.id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        : <Music2 />}
    </span>
  );
}

function SuggestedArtwork({ suggestion }: { suggestion: LibraryAssistantSuggestion }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [suggestion.id]);

  return (
    <span className="assistant-tabs__artwork is-suggested" aria-hidden="true">
      {failed
        ? <ImageIcon />
        : <img src={suggestionArtworkUrl(suggestion)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
    </span>
  );
}

export function AdminLibraryAssistantTabbedScreen({ onBack, onOpenLocalLyrics }: Props) {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [runs, setRuns] = useState<LibraryAssistantRun[]>([]);
  const [suggestions, setSuggestions] = useState<LibraryAssistantSuggestion[]>([]);
  const [reviewItems, setReviewItems] = useState<LibraryAssistantReviewItem[]>([]);
  const [progressByRun, setProgressByRun] = useState<Record<string, LibraryAssistantRunProgress>>({});
  const [trackStatesByRun, setTrackStatesByRun] = useState<Record<string, LibraryAssistantTrackAnalysisState[]>>({});
  const [activeTab, setActiveTab] = useState<CapabilityTab>('metadata');
  const [statusFilter, setStatusFilter] = useState<TrackStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startingCapability, setStartingCapability] = useState<CapabilityTab | null>(null);
  const [cancellingCapability, setCancellingCapability] = useState<CapabilityTab | null>(null);
  const [mutating, setMutating] = useState(false);
  const [batching, setBatching] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [policy, setPolicy] = useState<LibraryAssistantReviewPolicy>(
    () => ({ ...DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY })
  );
  const [policyReady, setPolicyReady] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [autonomy, setAutonomy] = useState<LibraryAssistantAutonomyState | null>(null);
  const [savingAutonomy, setSavingAutonomy] = useState(false);
  const [fingerprintStatus, setFingerprintStatus] = useState<LibraryAssistantFingerprintStatus | null>(null);
  const [fingerprintingId, setFingerprintingId] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const runByCapability = useMemo(() => Object.fromEntries(
    CAPABILITY_TABS.map(capability => [capability, latestRunFor(runs, capability)])
  ) as Record<CapabilityTab, LibraryAssistantRun | null>, [runs]);

  const activeRun = runByCapability[activeTab];
  const activeProgress = activeRun ? progressByRun[activeRun.id] ?? null : null;
  const activeRunStates = useMemo(() => new Map(
    (activeRun ? trackStatesByRun[activeRun.id] ?? [] : []).map(item => [item.trackId, item])
  ), [activeRun, trackStatesByRun]);

  const reviewMap = useMemo(
    () => new Map(reviewItems.map(item => [item.suggestion.id, item])),
    [reviewItems]
  );

  const openSuggestions = useMemo(
    () => suggestions.filter(item => isVisibleOpenSuggestion(policy, item)),
    [policy, suggestions]
  );

  const suggestionsByTrack = useMemo(() => {
    const map = new Map<string, LibraryAssistantSuggestion[]>();
    for (const suggestion of openSuggestions) {
      if (suggestion.target.capability !== activeTab) continue;
      const current = map.get(suggestion.target.trackId) ?? [];
      current.push(suggestion);
      map.set(suggestion.target.trackId, current);
    }
    return map;
  }, [activeTab, openSuggestions]);

  const trackRows = useMemo(() => tracks.map(track => {
    const work = activeRunStates.get(track.id) ?? null;
    const trackSuggestions = suggestionsByTrack.get(track.id) ?? [];
    return {
      track,
      work,
      suggestions: trackSuggestions,
      status: visualStatus(track, activeTab, work, trackSuggestions)
    };
  }), [activeRunStates, activeTab, suggestionsByTrack, tracks]);

  const statusCounts = useMemo(() => {
    const counts: Record<TrackVisualStatus, number> = {
      review: 0,
      suggestion: 0,
      ok: 0,
      pending: 0,
      failed: 0,
      'not-analyzed': 0
    };
    for (const row of trackRows) counts[row.status] += 1;
    return counts;
  }, [trackRows]);

  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');
  const filteredRows = useMemo(() => trackRows.filter(row => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (!normalizedSearch) return true;
    return [
      row.track.title,
      row.track.artist,
      row.track.album,
      row.track.albumArtist,
      row.track.folder
    ].some(value => value.toLocaleLowerCase('pt-BR').includes(normalizedSearch));
  }), [normalizedSearch, statusFilter, trackRows]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page]
  );

  const selectedRow = useMemo(
    () => trackRows.find(row => row.track.id === selectedTrackId)
      ?? visibleRows[0]
      ?? null,
    [selectedTrackId, trackRows, visibleRows]
  );

  const activeTabSuggestions = useMemo(
    () => openSuggestions.filter(item => item.target.capability === activeTab),
    [activeTab, openSuggestions]
  );

  const safeBatchSuggestions = useMemo(
    () => activeTab === 'artwork'
      ? []
      : activeTabSuggestions.filter(item => (
          isLibraryAssistantAutoApplicable(item) && reviewMap.has(item.id)
        )),
    [activeTab, activeTabSuggestions, reviewMap]
  );

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const [trackResponse, runResponse, reviewResponse] = await Promise.all([
        listAdminTracks(),
        getLibraryAssistantRuns(100),
        getLibraryAssistantReview(5_000)
      ]);
      if (version !== requestVersion.current) return;

      const relevantRuns = CAPABILITY_TABS
        .map(capability => latestRunFor(runResponse.runs, capability))
        .filter((run): run is LibraryAssistantRun => Boolean(run));

      const details = await Promise.all(relevantRuns.map(async run => {
        const [suggestionResponse, progressResponse, trackResponseForRun] = await Promise.all([
          getLibraryAssistantSuggestions(run.id),
          getLibraryAssistantRunProgress(run.id),
          getLibraryAssistantRunTracks(run.id)
        ]);
        return {
          run,
          suggestions: suggestionResponse.suggestions,
          progress: progressResponse.progress,
          tracks: trackResponseForRun.tracks
        };
      }));
      if (version !== requestVersion.current) return;

      setTracks(trackResponse.tracks);
      setRuns(runResponse.runs);
      setReviewItems(reviewResponse.items);
      setSuggestions(mergeSuggestions(
        details.flatMap(item => item.suggestions),
        reviewResponse.items
      ));
      setProgressByRun(Object.fromEntries(details.map(item => [item.run.id, item.progress])));
      setTrackStatesByRun(Object.fromEntries(details.map(item => [item.run.id, item.tracks])));
    } catch (error) {
      if (version === requestVersion.current) {
        setFeedback({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Não foi possível carregar o Assistente da Biblioteca.'
        });
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const [policyResponse, autonomyResponse] = await Promise.all([
        getLibraryAssistantReviewPolicy(),
        getLibraryAssistantAutonomy()
      ]);
      setPolicy(policyResponse.policy);
      setPolicyReady(true);
      setAutonomy(autonomyResponse);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível carregar as configurações.'
      });
    }
  }, []);

  const loadFingerprintStatus = useCallback(async () => {
    try {
      const response = await getLibraryAssistantFingerprintStatus();
      setFingerprintStatus(response);
    } catch {
      setFingerprintStatus(null);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSettings();
    void loadFingerprintStatus();
    return () => { requestVersion.current += 1; };
  }, [load, loadFingerprintStatus, loadSettings]);

  const anyRunActive = runs.some(run => !TERMINAL_RUNS.has(run.status));
  useEffect(() => {
    if (!anyRunActive) return;
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
  }, [anyRunActive, load]);

  useEffect(() => {
    setPage(1);
    setStatusFilter('all');
    setSelectedTrackId(null);
  }, [activeTab]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  async function startAnalysis(capability: CapabilityTab) {
    if (startingCapability || runIsActive(runByCapability[capability])) return;
    setStartingCapability(capability);
    setFeedback(null);
    try {
      const response = await startLibraryAssistantRun(capability, { full: true });
      setRuns(current => [
        response.run,
        ...current.filter(run => run.id !== response.run.id)
      ]);
      setFeedback({
        kind: 'success',
        message: `Análise de ${capabilityLabel(capability).toLocaleLowerCase('pt-BR')} iniciada. Você pode continuar usando as outras abas.`
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível iniciar a análise.'
      });
    } finally {
      setStartingCapability(null);
    }
  }

  async function cancelAnalysis(capability: CapabilityTab) {
    const run = runByCapability[capability];
    if (!run || !runIsActive(run) || cancellingCapability) return;
    setCancellingCapability(capability);
    setFeedback(null);
    try {
      await cancelSingleLibraryAssistantRun(run.id);
      setFeedback({
        kind: 'warning',
        message: `Análise de ${capabilityLabel(capability).toLocaleLowerCase('pt-BR')} cancelada.`
      });
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível cancelar a análise.'
      });
    } finally {
      setCancellingCapability(null);
    }
  }

  function decisionFor(
    suggestion: LibraryAssistantSuggestion,
    action: 'apply' | 'reject'
  ): LibraryAssistantDecision | null {
    const item = reviewMap.get(suggestion.id);
    if (!item) return null;
    return {
      runId: suggestion.runId,
      suggestionId: suggestion.id,
      action,
      expectedLibraryRevision: item.runLibraryRevision,
      expectedCurrentValue: expectedCurrentValue(suggestion)
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
        setFeedback({ kind: 'success', message: 'Sugestão aplicada. O arquivo original não foi modificado.' });
      } else if (result.outcome === 'rejected') {
        setFeedback({ kind: 'success', message: 'Sugestão rejeitada.' });
      } else if (result.outcome === 'stale') {
        setFeedback({ kind: 'warning', message: result.message ?? 'A sugestão ficou desatualizada. Analise novamente.' });
      } else {
        setFeedback({
          kind: result.outcome === 'already-applied' || result.outcome === 'already-rejected' ? 'success' : 'warning',
          message: result.message ?? 'A revisão foi atualizada.'
        });
      }
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível concluir a decisão.'
      });
    } finally {
      setMutating(false);
    }
  }

  async function identifyByAudio(suggestion: LibraryAssistantSuggestion) {
    if (
      suggestion.target.capability !== 'metadata'
      || !isOpen(suggestion)
      || isLibraryAssistantAutoApplicable(suggestion)
      || fingerprintingId
      || !fingerprintStatus?.fpcalc.available
    ) return;

    setFingerprintingId(suggestion.id);
    setFeedback(null);
    try {
      const result = await fingerprintLibraryAssistantSuggestion(suggestion.runId, suggestion.id);
      if (!result.externalLookup) {
        setFeedback({
          kind: 'success',
          message: result.cacheHit
            ? 'Fingerprint local reutilizado. Nenhum áudio foi enviado externamente.'
            : 'Fingerprint local gerado. Nenhum áudio foi enviado externamente.'
        });
      } else if (!result.identified) {
        setFeedback({
          kind: 'warning',
          message: 'O áudio foi analisado, mas não foi encontrada uma identificação confiável.'
        });
      } else if (result.ambiguous || result.conflict) {
        setFeedback({
          kind: 'warning',
          message: 'A identificação pelo áudio encontrou evidência adicional, mas o resultado continua exigindo revisão.'
        });
      } else {
        setFeedback({
          kind: 'success',
          message: 'A identificação pelo áudio reforçou a sugestão. Revise o resultado atualizado.'
        });
      }
      await load(true);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível identificar esta faixa pelo áudio.'
      });
    } finally {
      setFingerprintingId(null);
    }
  }

  async function applySafeSuggestions() {
    if (batching || mutating || safeBatchSuggestions.length === 0) return;
    setBatching(true);
    setMutating(true);
    setFeedback(null);
    let applied = 0;
    let failed = 0;
    try {
      for (let offset = 0; offset < safeBatchSuggestions.length; offset += 100) {
        const decisions = safeBatchSuggestions
          .slice(offset, offset + 100)
          .map(item => decisionFor(item, 'apply'))
          .filter((item): item is LibraryAssistantDecision => Boolean(item));
        if (decisions.length === 0) continue;
        const response = await decideLibraryAssistantBatch(decisions);
        applied += response.summary.applied;
        failed += response.summary.failed + response.summary.stale;
      }
      if (applied > 0) notifyLibraryChanged();
      setFeedback({
        kind: failed > 0 ? 'warning' : 'success',
        message: failed > 0
          ? `Lote concluído: ${applied} aplicadas e ${failed} não concluídas.`
          : `${applied} sugestão${applied === 1 ? '' : 'ões'} segura${applied === 1 ? '' : 's'} aplicada${applied === 1 ? '' : 's'}.`
      });
      await load(true);
    } finally {
      setBatching(false);
      setMutating(false);
    }
  }

  async function updatePolicyMode(key: LibraryAssistantReviewPolicyKey, mode: LibraryAssistantReviewMode) {
    if (!policyReady || savingPolicy || (key === 'artwork' && mode === 'bulk')) return;
    const previous = policy;
    const next = { ...policy, [key]: mode } as LibraryAssistantReviewPolicy;
    setPolicy(next);
    setSavingPolicy(true);
    try {
      const response = await updateLibraryAssistantReviewPolicy(next);
      setPolicy(response.policy);
      setFeedback({ kind: 'success', message: 'Política de revisão atualizada.' });
    } catch (error) {
      setPolicy(previous);
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível salvar a política.'
      });
    } finally {
      setSavingPolicy(false);
    }
  }

  async function toggleAutonomy() {
    if (!autonomy || savingAutonomy) return;
    setSavingAutonomy(true);
    try {
      const response = await updateLibraryAssistantAutonomy(!autonomy.config.enabled);
      setAutonomy(response);
      setFeedback({
        kind: 'success',
        message: response.config.enabled
          ? 'Automação segura ativada para campos de metadata vazios.'
          : 'Automação segura desativada.'
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível atualizar a automação.'
      });
    } finally {
      setSavingAutonomy(false);
    }
  }

  const activePercent = !activeRun
    ? 0
    : activeProgress?.total
      ? Math.min(100, Math.round((activeProgress.processed / activeProgress.total) * 100))
      : runIsActive(activeRun) ? 0 : 100;
  const selectedSuggestions = selectedRow?.suggestions ?? [];

  return (
    <section className="assistant-tabs" aria-labelledby="library-assistant-title">
      <header className="assistant-tabs__header">
        <button type="button" className="assistant-tabs__back" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="assistant-tabs__heading">
          <strong id="library-assistant-title">Assistente da Biblioteca</strong>
          <small>Analise cada tipo de correção separadamente e revise somente o que precisa da sua decisão.</small>
        </div>
        <div className="assistant-tabs__header-actions">
          <button type="button" className={showSettings ? 'is-active' : ''} onClick={() => setShowSettings(value => !value)}>
            <Settings /> Configurações
          </button>
          <button type="button" className="is-icon" aria-label="Como funciona" onClick={() => setShowHelp(value => !value)}>
            <HelpCircle />
          </button>
        </div>
      </header>

      {showHelp && (
        <aside className="assistant-tabs__help">
          <Info />
          <div>
            <strong>Uma análise por categoria</strong>
            <span>As três abas carregam toda a biblioteca. Ao analisar uma categoria, cada faixa recebe um estado próprio: OK, Sugestão, Revisar, Em análise ou Falha. Você pode iniciar outra categoria sem perder o progresso da atual.</span>
          </div>
        </aside>
      )}

      {feedback && (
        <div className={`assistant-tabs__feedback is-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.kind === 'success' ? <Check /> : <AlertTriangle />}
          <span>{feedback.message}</span>
          <button type="button" aria-label="Fechar mensagem" onClick={() => setFeedback(null)}><X /></button>
        </div>
      )}

      {showSettings ? (
        <section className="assistant-tabs__settings">
          <header>
            <div>
              <strong>Configurações</strong>
              <small>Controle quais sugestões aparecem e o comportamento automático seguro.</small>
            </div>
            <button type="button" onClick={() => setShowSettings(false)}><X /> Fechar</button>
          </header>

          <div className="assistant-tabs__settings-grid">
            <section>
              <strong>Política de revisão</strong>
              <p>“Ocultar” remove a sugestão da fila visual; “Revisar” mantém decisão individual; “Lote seguro” permite aplicar apenas resultados de alta confiança.</p>
              <div className="assistant-tabs__policy-list">
                {POLICY_ROWS.map(row => (
                  <fieldset key={row.key} disabled={!policyReady || savingPolicy}>
                    <legend>{row.label}</legend>
                    <small>{row.description}</small>
                    <div>
                      {POLICY_MODES.filter(([mode]) => row.allowBulk || mode !== 'bulk').map(([mode, label]) => (
                        <label key={mode}>
                          <input
                            type="radio"
                            name={`assistant-tab-policy-${row.key}`}
                            checked={policy[row.key] === mode}
                            onChange={() => void updatePolicyMode(row.key, mode)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>

            <section className="assistant-tabs__automation">
              <strong>Automação segura</strong>
              <p>Quando ativa, somente campos de metadata vazios e sugestões de alta confiança podem ser preenchidos automaticamente. Capas, letras e campos já preenchidos continuam manuais.</p>
              <button type="button" disabled={!autonomy || savingAutonomy} onClick={() => void toggleAutonomy()}>
                {savingAutonomy ? <LoaderCircle className="is-spinning" /> : <ShieldCheck />}
                {autonomy?.config.enabled ? 'Desativar automação' : 'Ativar automação segura'}
              </button>
            </section>
          </div>
        </section>
      ) : (
        <>
          <nav className="assistant-tabs__capabilities" aria-label="Tipo de análise">
            {CAPABILITY_TABS.map(capability => {
              const run = runByCapability[capability];
              const active = runIsActive(run);
              const Icon = capability === 'metadata' ? Sparkles : capability === 'artwork' ? ImageIcon : FileText;
              return (
                <button
                  key={capability}
                  type="button"
                  className={activeTab === capability ? 'is-active' : ''}
                  onClick={() => setActiveTab(capability)}
                >
                  <Icon />
                  <span>
                    <strong>{capabilityLabel(capability)}</strong>
                    <small>{active ? 'Análise em andamento' : `Última: ${formatRunDate(run)}`}</small>
                  </span>
                  {active && <i />}
                </button>
              );
            })}
          </nav>

          <section className={`assistant-tabs__hero is-${activeTab}`}>
            <div className="assistant-tabs__hero-copy">
              <span className="assistant-tabs__hero-icon">
                {activeTab === 'metadata' ? <Sparkles /> : activeTab === 'artwork' ? <ImageIcon /> : <FileText />}
              </span>
              <div>
                <strong>{capabilityLabel(activeTab)}</strong>
                <p>{capabilityDescription(activeTab)}</p>
                <small>Última execução: {formatRunDate(activeRun)}</small>
              </div>
            </div>

            <div className="assistant-tabs__hero-progress">
              <div>
                <span>
                  {activeRun
                    ? runIsActive(activeRun)
                      ? activeRun.status === 'queued' ? 'Na fila' : 'Analisando'
                      : activeRun.status === 'completed' ? 'Concluída' : activeRun.status === 'failed' ? 'Falhou' : 'Finalizada'
                    : 'Ainda não executada'}
                </span>
                <strong>{activeProgress?.total ? `${activeProgress.processed.toLocaleString('pt-BR')} / ${activeProgress.total.toLocaleString('pt-BR')}` : '—'}</strong>
              </div>
              <div className="assistant-tabs__progress" aria-label={`Progresso: ${activePercent}%`}>
                <span style={{ width: `${activePercent}%` }} />
              </div>
              {activeProgress?.retry ? (
                <small>{activeProgress.retry.toLocaleString('pt-BR')} aguardando nova tentativa · {activeProgress.failed.toLocaleString('pt-BR')} falhas</small>
              ) : (
                <small>{activeProgress?.failed ? `${activeProgress.failed.toLocaleString('pt-BR')} falhas` : 'A lista é atualizada enquanto a análise avança.'}</small>
              )}
            </div>

            <div className="assistant-tabs__hero-actions">
              {runIsActive(activeRun) ? (
                <button
                  type="button"
                  className="is-cancel"
                  disabled={cancellingCapability === activeTab}
                  onClick={() => void cancelAnalysis(activeTab)}
                >
                  {cancellingCapability === activeTab ? <LoaderCircle className="is-spinning" /> : <X />}
                  Cancelar análise
                </button>
              ) : (
                <button
                  type="button"
                  className="is-primary"
                  disabled={Boolean(startingCapability)}
                  onClick={() => void startAnalysis(activeTab)}
                >
                  {startingCapability === activeTab ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}
                  {startingCapability === activeTab ? 'Iniciando…' : analyzeButtonLabel(activeTab, activeRun)}
                </button>
              )}
              {activeTab === 'lyrics' && onOpenLocalLyrics && (
                <button type="button" className="is-secondary" onClick={onOpenLocalLyrics}>
                  <FileText /> Lyrics local
                </button>
              )}
            </div>
          </section>

          <section className="assistant-tabs__summary" aria-label="Estados das faixas">
            <button type="button" className={statusFilter === 'all' ? 'is-active' : ''} onClick={() => setStatusFilter('all')}>
              <strong>{tracks.length.toLocaleString('pt-BR')}</strong><span>Todas</span>
            </button>
            <button type="button" className={statusFilter === 'review' ? 'is-active is-review' : 'is-review'} onClick={() => setStatusFilter('review')}>
              <strong>{statusCounts.review.toLocaleString('pt-BR')}</strong><span>Revisar</span>
            </button>
            <button type="button" className={statusFilter === 'suggestion' ? 'is-active is-suggestion' : 'is-suggestion'} onClick={() => setStatusFilter('suggestion')}>
              <strong>{statusCounts.suggestion.toLocaleString('pt-BR')}</strong><span>Sugestões</span>
            </button>
            <button type="button" className={statusFilter === 'ok' ? 'is-active is-ok' : 'is-ok'} onClick={() => setStatusFilter('ok')}>
              <strong>{statusCounts.ok.toLocaleString('pt-BR')}</strong><span>OK</span>
            </button>
            <button type="button" className={statusFilter === 'pending' ? 'is-active is-pending' : 'is-pending'} onClick={() => setStatusFilter('pending')}>
              <strong>{statusCounts.pending.toLocaleString('pt-BR')}</strong><span>Em análise</span>
            </button>
            <button type="button" className={statusFilter === 'failed' ? 'is-active is-failed' : 'is-failed'} onClick={() => setStatusFilter('failed')}>
              <strong>{statusCounts.failed.toLocaleString('pt-BR')}</strong><span>Falhas</span>
            </button>
            <button type="button" className={statusFilter === 'not-analyzed' ? 'is-active is-not-analyzed' : 'is-not-analyzed'} onClick={() => setStatusFilter('not-analyzed')}>
              <strong>{statusCounts['not-analyzed'].toLocaleString('pt-BR')}</strong><span>Não analisadas</span>
            </button>
            {safeBatchSuggestions.length > 0 && (
              <div className="assistant-tabs__safe-apply">
                <span><ShieldCheck /> {safeBatchSuggestions.length.toLocaleString('pt-BR')} seguras</span>
                <button type="button" disabled={mutating} onClick={() => void applySafeSuggestions()}>
                  {batching ? <LoaderCircle className="is-spinning" /> : <CheckCircle2 />}
                  Aplicar seguras
                </button>
              </div>
            )}
          </section>

          <section className="assistant-tabs__workspace">
            <div className="assistant-tabs__list-panel">
              <div className="assistant-tabs__toolbar">
                <label>
                  <Search />
                  <input
                    type="search"
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar título, artista, álbum ou pasta…"
                    aria-label="Buscar faixas"
                  />
                </label>
                <span>{filteredRows.length.toLocaleString('pt-BR')} faixas</span>
              </div>

              <div className="assistant-tabs__table">
                <div className="assistant-tabs__table-head">
                  <span>Música</span>
                  <span>Álbum</span>
                  <span>Estado</span>
                  <span></span>
                </div>

                {loading && tracks.length === 0 ? (
                  <div className="assistant-tabs__empty"><LoaderCircle className="is-spinning" /> Carregando biblioteca…</div>
                ) : visibleRows.length === 0 ? (
                  <div className="assistant-tabs__empty"><Search /> Nenhuma faixa neste filtro.</div>
                ) : (
                  <div className="assistant-tabs__rows">
                    {visibleRows.map(row => (
                      <button
                        type="button"
                        key={row.track.id}
                        className={selectedRow?.track.id === row.track.id ? 'is-selected' : ''}
                        onClick={() => setSelectedTrackId(row.track.id)}
                      >
                        <span className="assistant-tabs__song">
                          <TrackArtwork track={row.track} />
                          <span>
                            <strong>{row.track.title}</strong>
                            <small>{row.track.artist}</small>
                          </span>
                        </span>
                        <span className="assistant-tabs__album">{row.track.album}</span>
                        <span>
                          <i className={`assistant-tabs__status is-${row.status}`}>
                            {row.status === 'ok' ? <CheckCircle2 /> : row.status === 'failed' ? <XCircle /> : row.status === 'review' ? <AlertTriangle /> : row.status === 'suggestion' ? <Sparkles /> : row.status === 'pending' ? <LoaderCircle className={row.work?.status === 'processing' ? 'is-spinning' : ''} /> : <Info />}
                            {statusLabel(row.status, row.work)}
                          </i>
                        </span>
                        <ChevronRight />
                      </button>
                    ))}
                  </div>
                )}

                <footer className="assistant-tabs__pagination">
                  <span>{statusCounts['not-analyzed'] > 0 ? `${statusCounts['not-analyzed'].toLocaleString('pt-BR')} ainda não analisadas` : 'Biblioteca classificada'}</span>
                  <div>
                    <span>{PAGE_SIZE} por página</span>
                    <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft /></button>
                    <strong>{page}</strong>
                    <span>de {pageCount}</span>
                    <button type="button" aria-label="Próxima página" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}><ChevronRight /></button>
                  </div>
                </footer>
              </div>
            </div>

            <aside className="assistant-tabs__inspector">
              {!selectedRow ? (
                <div className="assistant-tabs__inspector-empty">
                  <Music2 />
                  <strong>Selecione uma faixa</strong>
                  <span>O diagnóstico e as sugestões aparecerão aqui.</span>
                </div>
              ) : (
                <>
                  <header className="assistant-tabs__track-header">
                    <TrackArtwork track={selectedRow.track} />
                    <div>
                      <strong>{selectedRow.track.title}</strong>
                      <span>{selectedRow.track.artist}</span>
                      <small>{selectedRow.track.album}</small>
                    </div>
                    <i className={`assistant-tabs__status is-${selectedRow.status}`}>
                      {statusLabel(selectedRow.status, selectedRow.work)}
                    </i>
                  </header>

                  <div className="assistant-tabs__diagnosis">
                    <strong>Diagnóstico de {capabilityLabel(activeTab).toLocaleLowerCase('pt-BR')}</strong>
                    {selectedSuggestions.length === 0 ? (
                      <div className={`assistant-tabs__diagnosis-empty is-${selectedRow.status}`}>
                        {selectedRow.status === 'ok' ? <CheckCircle2 /> : selectedRow.status === 'failed' ? <XCircle /> : selectedRow.status === 'pending' ? <LoaderCircle className="is-spinning" /> : <Info />}
                        <div>
                          <strong>
                            {selectedRow.status === 'ok'
                              ? 'Nenhuma correção necessária'
                              : selectedRow.status === 'failed'
                                ? 'A análise desta faixa falhou'
                                : selectedRow.status === 'pending'
                                  ? 'Esta faixa está sendo analisada'
                                  : 'Esta faixa ainda não foi analisada'}
                          </strong>
                          <small>
                            {selectedRow.status === 'failed'
                              ? selectedRow.work?.error?.message ?? 'Tente executar esta análise novamente.'
                              : selectedRow.status === 'ok'
                                ? 'Nenhuma sugestão aberta foi encontrada nesta categoria.'
                                : selectedRow.status === 'pending'
                                  ? 'O estado será atualizado automaticamente.'
                                  : `Use “${analyzeButtonLabel(activeTab, activeRun)}” para gerar o diagnóstico.`}
                          </small>
                        </div>
                      </div>
                    ) : (
                      <div className="assistant-tabs__suggestion-list">
                        {selectedSuggestions.map(suggestion => {
                          const safe = isLibraryAssistantAutoApplicable(suggestion);
                          const canDecide = reviewMap.has(suggestion.id);
                          return (
                            <article key={suggestion.id}>
                              <header>
                                <div>
                                  <strong>{suggestionTitle(suggestion)}</strong>
                                  <span className={safe ? 'is-safe' : 'is-review'}>
                                    {safe ? <CheckCircle2 /> : <AlertTriangle />}
                                    {safe ? 'Sugestão segura' : 'Revisar'}
                                  </span>
                                </div>
                                {canDecide && (
                                  <div>
                                    <button type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'reject')}>Rejeitar</button>
                                    <button className="is-primary" type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'apply')}>
                                      <Check /> Aplicar
                                    </button>
                                  </div>
                                )}
                              </header>

                              {suggestion.target.capability === 'metadata' ? (
                                <div className="assistant-tabs__metadata-change">
                                  <div><small>Atual</small><span>{suggestion.target.currentValue || '—'}</span></div>
                                  <ChevronRight />
                                  <div><small>Sugestão</small><span>{suggestion.target.suggestedValue}</span></div>
                                </div>
                              ) : suggestion.target.capability === 'artwork' ? (
                                <div className="assistant-tabs__artwork-change">
                                  <div><TrackArtwork track={selectedRow.track} /><small>Atual</small></div>
                                  <ChevronRight />
                                  <div><SuggestedArtwork suggestion={suggestion} /><small>Sugerida</small></div>
                                </div>
                              ) : (
                                <p className="assistant-tabs__lyrics-preview">{suggestion.target.preview}</p>
                              )}

                              <footer>
                                <span>Confiança: {suggestion.confidence === 'high' ? 'Alta' : suggestion.confidence === 'medium' ? 'Média' : 'Baixa'}</span>
                                {suggestion.target.capability === 'metadata' && !safe && (
                                  <button
                                    type="button"
                                    className="assistant-tabs__fingerprint"
                                    disabled={mutating || Boolean(fingerprintingId) || !fingerprintStatus?.fpcalc.available}
                                    title={fingerprintStatus?.fpcalc.available ? undefined : 'Chromaprint indisponível neste servidor'}
                                    onClick={() => void identifyByAudio(suggestion)}
                                  >
                                    {fingerprintingId === suggestion.id
                                      ? <LoaderCircle className="is-spinning" />
                                      : <Fingerprint />}
                                    {fingerprintingId === suggestion.id ? 'Identificando…' : 'Identificar pelo áudio'}
                                  </button>
                                )}
                              </footer>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <p className="assistant-tabs__override-note">
                    <Info /> Alterações aprovadas são aplicadas como overrides; os arquivos originais permanecem intactos.
                  </p>
                </>
              )}
            </aside>
          </section>
        </>
      )}
    </section>
  );
}
