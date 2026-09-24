import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY,
  isLibraryAssistantAutoApplicable,
  type LibraryAssistantArtworkTarget,
  type LibraryAssistantDecision,
  type LibraryAssistantDecisionResult,
  type LibraryAssistantMetadataField,
  type LibraryAssistantReviewItem,
  type LibraryAssistantReviewMode,
  type LibraryAssistantReviewPolicy,
  type LibraryAssistantReviewPolicyKey,
  type LibraryAssistantRun,
  type LibraryAssistantRunProgress,
  type LibraryAssistantSuggestion,
  type LibraryAssistantSuggestionStatus,
  type LocalLyricsCapabilityResponse
} from '@home-music/shared/library-assistant';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
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
  cancelLibraryAssistantRun,
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  fingerprintLibraryAssistantSuggestion,
  getLibraryAssistantAutonomy,
  getLibraryAssistantFingerprintStatus,
  getLibraryAssistantReview,
  getLibraryAssistantReviewPolicy,
  getLibraryAssistantRunProgress,
  getLibraryAssistantRuns,
  getLibraryAssistantSuggestions,
  getLocalLyricsCapability,
  resetLibraryAssistantReview,
  startLibraryAssistantAnalysis,
  updateLibraryAssistantAutonomy,
  updateLibraryAssistantReviewPolicy,
  type LibraryAssistantAnalysisTarget,
  type LibraryAssistantAutonomyState,
  type LibraryAssistantFingerprintStatus
} from '../library-assistant-client';
import { notifyLibraryChanged } from '../library-events';
import '../library-assistant-admin.css';
import '../library-assistant-operations.css';

type Props = {
  onBack: () => void;
  onOpenLocalLyrics?: () => void;
};
type Filter = 'all' | 'metadata' | 'artwork' | 'lyrics' | 'review' | 'failed';
type Sort = 'recent' | 'oldest';
type Section = 'suggestions' | 'processing' | 'settings';
type Feedback = { kind: 'success' | 'error' | 'warning'; message: string; details?: string[] };
type PolicyRow = {
  key: LibraryAssistantReviewPolicyKey;
  label: string;
  description: string;
  allowBulk: boolean;
};

const TERMINAL_RUNS = new Set(['completed', 'failed', 'cancelled', 'stale']);
const BATCH_SIZE = 100;
const ANALYSIS_ACTIONS: readonly [LibraryAssistantAnalysisTarget, string, string][] = [
  ['title', 'Título', 'Busca somente correções de título'],
  ['artist', 'Artista', 'Busca somente correções de artista'],
  ['album', 'Álbum', 'Busca somente correções de álbum'],
  ['albumArtist', 'Artista do álbum', 'Busca somente correções do artista do álbum'],
  ['artwork', 'Capas', 'Busca somente capas ausentes'],
  ['lyrics', 'Letras', 'Busca somente letras ausentes'],
  ['all', 'Tudo', 'Analisa metadados, capas e letras']
];
const FIELD_LABELS: Record<LibraryAssistantMetadataField, string> = {
  title: 'Título',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista do álbum'
};
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
    key: 'lyrics',
    label: 'Letras',
    description: 'Letras externas encontradas para faixas sem uma letra local efetiva.',
    allowBulk: true
  },
  {
    key: 'artwork',
    label: 'Capa',
    description: 'Capas externas continuam com aplicação individual antes do download.',
    allowBulk: false
  }
];
const EMPTY_PROGRESS: LibraryAssistantRunProgress = {
  total: 0,
  processed: 0,
  pending: 0,
  processing: 0,
  matched: 0,
  noMatch: 0,
  retry: 0,
  failed: 0,
  nextRetryAt: null
};

function isOpen(suggestion: LibraryAssistantSuggestion) {
  return suggestion.status === 'pending' || suggestion.status === 'review';
}

function isSafe(suggestion: LibraryAssistantSuggestion) {
  return isLibraryAssistantAutoApplicable(suggestion);
}

function canTryFingerprint(suggestion: LibraryAssistantSuggestion) {
  return suggestion.target.capability === 'metadata' && isOpen(suggestion) && !isSafe(suggestion);
}

function canApplyInBatch(suggestion: LibraryAssistantSuggestion) {
  return suggestion.target.capability !== 'artwork' && isOpen(suggestion);
}

function isBatchSafe(suggestion: LibraryAssistantSuggestion) {
  return canApplyInBatch(suggestion) && isSafe(suggestion);
}

function policyModeForSuggestion(
  policy: LibraryAssistantReviewPolicy,
  suggestion: LibraryAssistantSuggestion
): LibraryAssistantReviewMode {
  if (suggestion.target.capability === 'metadata') return policy[suggestion.target.field];
  if (suggestion.target.capability === 'artwork') return policy.artwork;
  return policy.lyrics;
}

function runTitle(run: LibraryAssistantRun | null) {
  if (!run) return 'Pronto para analisar sua biblioteca';
  if (run.status === 'queued') return 'Análise na fila';
  if (run.status === 'running') return 'Analisando sua biblioteca';
  if (run.status === 'failed') return 'Análise interrompida';
  if (run.status === 'cancelled') return 'Análise cancelada';
  if (run.status === 'stale') return 'Análise desatualizada';
  return 'Análise concluída';
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

function artworkExpectedValue(target: LibraryAssistantArtworkTarget) {
  return target.currentHasCover ? target.currentCoverVersion ?? 'physical' : '';
}

function expectedCurrentValue(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability === 'metadata') return suggestion.target.currentValue;
  if (suggestion.target.capability === 'artwork') return artworkExpectedValue(suggestion.target);
  return suggestion.target.currentValue;
}

function capabilityLabel(suggestion: LibraryAssistantSuggestion) {
  if (suggestion.target.capability === 'artwork') return 'Capa';
  if (suggestion.target.capability === 'metadata') return FIELD_LABELS[suggestion.target.field];
  return 'Letra';
}

function provenanceLabel(source: LibraryAssistantSuggestion['provenance']['source']) {
  return ({
    local: 'Local',
    musicbrainz: 'MusicBrainz',
    'cover-art-archive': 'Cover Art Archive',
    lrclib: 'LRCLIB',
    acoustid: 'AcoustID',
    generated: 'Gerada',
    'local-transcription': 'Transcrição local',
    'local-alignment': 'Alinhamento local'
  } satisfies Record<LibraryAssistantSuggestion['provenance']['source'], string>)[source];
}

function rowDetail(suggestion: LibraryAssistantSuggestion, item?: LibraryAssistantReviewItem) {
  if (suggestion.target.capability === 'artwork') {
    const album = item?.track.album || 'álbum identificado';
    return suggestion.target.label ?? `Capa frontal para ${album}`;
  }
  if (suggestion.target.capability === 'metadata') {
    return `${FIELD_LABELS[suggestion.target.field]}: “${suggestion.target.currentValue || '—'}” → “${suggestion.target.suggestedValue}”`;
  }
  return `Fonte: LRCLIB · ${suggestion.target.synchronized ? 'sincronizada' : 'não sincronizada'} · “${suggestion.target.preview}”`;
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
    target.capability === 'artwork' ? target.musicBrainzReleaseGroupId : null,
    target.capability === 'lyrics' ? target.preview : null,
    target.capability === 'lyrics' ? target.candidateId : null,
    target.capability === 'lyrics' ? 'lrclib letra lyrics' : null
  ].filter(Boolean).join(' ');
}

function batchOutcomeLabel(result: LibraryAssistantDecisionResult) {
  if (result.outcome === 'not-found') return 'não encontrada';
  if (result.outcome === 'unsupported') return 'não suportada';
  if (result.outcome === 'failed') return 'falhou';
  if (result.outcome === 'stale') return 'desatualizada';
  return result.outcome;
}

function fingerprintIssueLabel(issue: LibraryAssistantFingerprintStatus['fpcalc']['issue']) {
  if (issue === 'not-found') return 'fpcalc não encontrado';
  if (issue === 'timeout') return 'fpcalc não respondeu';
  if (issue === 'invalid-command') return 'configuração de fpcalc inválida';
  if (issue === 'invalid-output') return 'versão do fpcalc não reconhecida';
  if (issue === 'failed') return 'falha ao executar fpcalc';
  return 'Chromaprint indisponível';
}

function aggregateProgress(values: LibraryAssistantRunProgress[]) {
  if (values.length === 0) return EMPTY_PROGRESS;
  const metrics = values.map(value => value.metrics).filter((value): value is NonNullable<LibraryAssistantRunProgress['metrics']> => Boolean(value));
  const aggregate: LibraryAssistantRunProgress = {
    total: values.reduce((sum, value) => sum + value.total, 0),
    processed: values.reduce((sum, value) => sum + value.processed, 0),
    pending: values.reduce((sum, value) => sum + value.pending, 0),
    processing: values.reduce((sum, value) => sum + value.processing, 0),
    matched: values.reduce((sum, value) => sum + value.matched, 0),
    noMatch: values.reduce((sum, value) => sum + value.noMatch, 0),
    retry: values.reduce((sum, value) => sum + value.retry, 0),
    failed: values.reduce((sum, value) => sum + value.failed, 0),
    nextRetryAt: values
      .map(value => value.nextRetryAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null
  };
  if (metrics.length > 0) {
    aggregate.metrics = {
      elapsedMs: Math.max(...metrics.map(value => value.elapsedMs)),
      tracksPerSecond: metrics.reduce((sum, value) => sum + value.tracksPerSecond, 0),
      etaMs: metrics.some(value => value.etaMs == null) ? null : Math.max(...metrics.map(value => value.etaMs ?? 0)),
      searchAttempts: metrics.reduce((sum, value) => sum + value.searchAttempts, 0),
      externalRequests: metrics.reduce((sum, value) => sum + value.externalRequests, 0),
      cacheHits: metrics.reduce((sum, value) => sum + value.cacheHits, 0),
      cacheMisses: metrics.reduce((sum, value) => sum + value.cacheMisses, 0),
      rateLimitWaitMs: metrics.reduce((sum, value) => sum + value.rateLimitWaitMs, 0),
      retriesTotal: metrics.reduce((sum, value) => sum + value.retriesTotal, 0),
      retriesByReason: Object.assign({}, ...metrics.map(value => value.retriesByReason))
    };
  }
  return aggregate;
}

function progressLabel(progress: LibraryAssistantRunProgress | null, run: LibraryAssistantRun | null) {
  if (!run) return 'Aguardando';
  if (!progress || progress.total === 0) return runStatusLabel(run);
  const completed = Math.min(progress.processed, progress.total);
  if (run.status === 'completed') return `${completed.toLocaleString('pt-BR')} / ${progress.total.toLocaleString('pt-BR')} verificações`;
  const parts = [`${completed.toLocaleString('pt-BR')} / ${progress.total.toLocaleString('pt-BR')} verificações`];
  if (progress.retry > 0) parts.push(`${progress.retry.toLocaleString('pt-BR')} em retry`);
  if (progress.failed > 0) parts.push(`${progress.failed.toLocaleString('pt-BR')} falha${progress.failed === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function retryLabel(progress: LibraryAssistantRunProgress | null) {
  if (!progress || progress.retry === 0 || !progress.nextRetryAt) return null;
  const retryAt = Date.parse(progress.nextRetryAt);
  if (!Number.isFinite(retryAt)) return null;
  const remainingMs = Math.max(0, retryAt - Date.now());
  if (remainingMs < 1_000) return 'nova tentativa a qualquer momento';
  const totalSeconds = Math.ceil(remainingMs / 1_000);
  if (totalSeconds < 60) return `próxima tentativa em ${totalSeconds}s`;
  const minutes = Math.ceil(totalSeconds / 60);
  if (minutes < 60) return `próxima tentativa em ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `próxima tentativa em ${hours}h${rest ? ` ${rest}min` : ''}`;
}

function runsBelongTogether(left: LibraryAssistantRun | null, right: LibraryAssistantRun | null) {
  if (!left || !right) return false;
  const leftAt = Date.parse(left.createdAt);
  const rightAt = Date.parse(right.createdAt);
  return Number.isFinite(leftAt) && Number.isFinite(rightAt) && Math.abs(leftAt - rightAt) <= 10_000;
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

function AssistantSuggestedArtwork({
  runId,
  suggestionId
}: {
  runId: string;
  suggestionId: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = `/api/admin/library-assistant/runs/${encodeURIComponent(runId)}/suggestions/${encodeURIComponent(suggestionId)}/artwork-preview`;

  useEffect(() => setFailed(false), [runId, suggestionId]);

  return (
    <span className="assistant-admin-row__artwork assistant-v2__suggested-artwork" aria-hidden="true">
      {failed ? (
        <ImageIcon />
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

export function AdminLibraryAssistantScreen({ onBack, onOpenLocalLyrics }: Props) {
  const [runs, setRuns] = useState<LibraryAssistantRun[]>([]);
  const [suggestions, setSuggestions] = useState<LibraryAssistantSuggestion[]>([]);
  const [reviewItems, setReviewItems] = useState<LibraryAssistantReviewItem[]>([]);
  const [progress, setProgress] = useState<LibraryAssistantRunProgress>(EMPTY_PROGRESS);
  const [libraryCounts, setLibraryCounts] = useState({ total: 0, active: 0, inactive: 0 });
  const [policy, setPolicy] = useState<LibraryAssistantReviewPolicy>(
    () => ({ ...DEFAULT_LIBRARY_ASSISTANT_REVIEW_POLICY })
  );
  const [policyReady, setPolicyReady] = useState(false);
  const [fingerprintStatus, setFingerprintStatus] = useState<LibraryAssistantFingerprintStatus | null>(null);
  const [fingerprintStatusError, setFingerprintStatusError] = useState<string | null>(null);
  const [fingerprintingId, setFingerprintingId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('suggestions');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [search, setSearch] = useState('');
  const [suggestionPage, setSuggestionPage] = useState(1);
  const [showHelp, setShowHelp] = useState(false);
  const [analysisMenuOpen, setAnalysisMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeSuggestionId, setActiveSuggestionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [loadingFingerprintStatus, setLoadingFingerprintStatus] = useState(true);
  const [localLyricsCapability, setLocalLyricsCapability] = useState<LocalLyricsCapabilityResponse | null>(null);
  const [localLyricsCapabilityError, setLocalLyricsCapabilityError] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<LibraryAssistantAutonomyState | null>(null);
  const [autonomyError, setAutonomyError] = useState<string | null>(null);
  const [savingAutonomy, setSavingAutonomy] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [batching, setBatching] = useState(false);
  const [confirmReviewCount, setConfirmReviewCount] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [suggestionErrors, setSuggestionErrors] = useState<Record<string, string>>({});
  const [runProgress, setRunProgress] = useState<Record<string, LibraryAssistantRunProgress>>({});
  const requestVersion = useRef(0);
  const policyRequestVersion = useRef(0);
  const fingerprintRequestVersion = useRef(0);

  const latestRun = runs[0] ?? null;
  const analysisRuns = useMemo(() => {
    const active = runs.filter(run => !TERMINAL_RUNS.has(run.status));
    if (active.length > 0) return active;
    const newest = runs[0] ?? null;
    return newest ? runs.filter(run => runsBelongTogether(newest, run)) : [];
  }, [runs]);
  const activeRuns = useMemo(() => analysisRuns.filter(run => !TERMINAL_RUNS.has(run.status)), [analysisRuns]);
  const statusRun = useMemo(
    () => analysisRuns.find(run => run.status === 'failed') ?? activeRuns[0] ?? latestRun,
    [activeRuns, analysisRuns, latestRun]
  );
  const metadataRun = analysisRuns.find(run => run.capability === 'metadata') ?? null;
  const artworkRun = analysisRuns.find(run => run.capability === 'artwork') ?? null;
  const lyricsRun = analysisRuns.find(run => run.capability === 'lyrics') ?? null;
  const runActive = activeRuns.length > 0;
  const reviewMap = useMemo(() => new Map(reviewItems.map(item => [item.suggestion.id, item])), [reviewItems]);
  const reviewableSuggestions = useMemo(
    () => suggestions.filter(item => isOpen(item) || item.status === 'failed'),
    [suggestions]
  );
  const safeSuggestions = useMemo(
    () => reviewableSuggestions.filter(item => isBatchSafe(item)),
    [reviewableSuggestions]
  );
  const reviewSuggestions = useMemo(
    () => reviewableSuggestions.filter(item => isOpen(item) && !isBatchSafe(item)),
    [reviewableSuggestions]
  );
  const normalizedSearch = search.trim().toLocaleLowerCase('pt-BR');

  const visibleSuggestions = useMemo(() => {
    const filtered = reviewableSuggestions.filter(suggestion => {
      if (isOpen(suggestion) && policyModeForSuggestion(policy, suggestion) === 'ignore') return false;
      if (filter !== 'all') {
        if (filter === 'metadata' && suggestion.target.capability !== 'metadata') return false;
        if (filter === 'artwork' && suggestion.target.capability !== 'artwork') return false;
        if (filter === 'lyrics' && suggestion.target.capability !== 'lyrics') return false;
        if (filter === 'review' && (!isOpen(suggestion) || isBatchSafe(suggestion))) return false;
        if (filter === 'failed' && suggestion.status !== 'failed') return false;
      }
      if (!normalizedSearch) return true;
      return searchText(suggestion, reviewMap.get(suggestion.id)).toLocaleLowerCase('pt-BR').includes(normalizedSearch);
    });
    return filtered.sort((left, right) => {
      const created = left.createdAt.localeCompare(right.createdAt);
      const stable = created || left.id.localeCompare(right.id);
      return sort === 'recent' ? -stable : stable;
    });
  }, [filter, normalizedSearch, policy, reviewMap, reviewableSuggestions, sort]);

  const visibleSafeSuggestions = useMemo(
    () => visibleSuggestions.filter(item => isBatchSafe(item) && reviewMap.has(item.id)),
    [reviewMap, visibleSuggestions]
  );
  const visibleActionableSuggestions = useMemo(
    () => visibleSuggestions.filter(item => canApplyInBatch(item) && reviewMap.has(item.id)),
    [reviewMap, visibleSuggestions]
  );


  const activeSuggestion = useMemo(
    () => visibleSuggestions.find(item => item.id === activeSuggestionId) ?? visibleSuggestions[0] ?? null,
    [activeSuggestionId, visibleSuggestions]
  );
  const activeReviewItem = activeSuggestion ? reviewMap.get(activeSuggestion.id) ?? null : null;
  const activeTrackSuggestions = useMemo(
    () => activeSuggestion
      ? visibleSuggestions.filter(item => item.target.trackId === activeSuggestion.target.trackId)
      : [],
    [activeSuggestion, visibleSuggestions]
  );
  const activeTrackSelectedCount = useMemo(
    () => activeTrackSuggestions.filter(item => selected.has(item.id)).length,
    [activeTrackSuggestions, selected]
  );
  const suggestionPageCount = Math.max(1, Math.ceil(visibleSuggestions.length / 50));
  const pagedVisibleSuggestions = useMemo(
    () => visibleSuggestions.slice((suggestionPage - 1) * 50, suggestionPage * 50),
    [suggestionPage, visibleSuggestions]
  );

  const load = useCallback(async (quiet = false) => {
    const version = ++requestVersion.current;
    if (!quiet) setLoading(true);
    try {
      const runsResponse = await getLibraryAssistantRuns();
      if (version !== requestVersion.current) return;
      const active = runsResponse.runs.filter(run => !TERMINAL_RUNS.has(run.status));
      const newest = runsResponse.runs[0] ?? null;
      const currentRuns = active.length > 0
        ? active
        : newest
          ? runsResponse.runs.filter(run => runsBelongTogether(newest, run))
          : [];
      const [reviewResponse, suggestionResponses, progressResponses] = await Promise.all([
        getLibraryAssistantReview(5_000),
        Promise.all(currentRuns.map(run => getLibraryAssistantSuggestions(run.id))),
        Promise.all(currentRuns.map(run => getLibraryAssistantRunProgress(run.id)))
      ]);
      if (version !== requestVersion.current) return;
      const progressByRun = Object.fromEntries(
        currentRuns.map((run, index) => [run.id, progressResponses[index]?.progress ?? EMPTY_PROGRESS])
      );
      setRuns(runsResponse.runs);
      setReviewItems(reviewResponse.items);
      setSuggestions(mergeSuggestions(
        suggestionResponses.flatMap(response => response.suggestions),
        reviewResponse.items
      ));
      setRunProgress(progressByRun);
      setProgress(aggregateProgress(progressResponses.map(response => response.progress)));
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

  const loadLibraryCounts = useCallback(async () => {
    try {
      const response = await listAdminTracks();
      setLibraryCounts({
        total: response.active + response.inactive,
        active: response.active,
        inactive: response.inactive
      });
    } catch {
      // A contagem é informativa e não deve bloquear o Assistente.
    }
  }, []);

  const loadPolicy = useCallback(async (quiet = false) => {
    const version = ++policyRequestVersion.current;
    if (!quiet) setLoadingPolicy(true);
    try {
      const response = await getLibraryAssistantReviewPolicy();
      if (version !== policyRequestVersion.current) return;
      setPolicy(response.policy);
      setPolicyReady(true);
    } catch (error) {
      if (version === policyRequestVersion.current) {
        setFeedback({
          kind: 'error',
          message: error instanceof Error
            ? error.message
            : 'Não foi possível carregar a política de revisão.'
        });
      }
    } finally {
      if (version === policyRequestVersion.current) setLoadingPolicy(false);
    }
  }, []);

  const loadLocalLyricsCapability = useCallback(async () => {
    try {
      const response = await getLocalLyricsCapability();
      setLocalLyricsCapability(response);
      setLocalLyricsCapabilityError(null);
    } catch (error) {
      setLocalLyricsCapability(null);
      setLocalLyricsCapabilityError(error instanceof Error ? error.message : 'Não foi possível verificar o Whisper local.');
    }
  }, []);

  const loadAutonomy = useCallback(async () => {
    try {
      const response = await getLibraryAssistantAutonomy();
      setAutonomy(response);
      setAutonomyError(null);
    } catch (error) {
      setAutonomy(null);
      setAutonomyError(error instanceof Error ? error.message : 'Não foi possível carregar a automação segura.');
    }
  }, []);

  const loadFingerprintStatus = useCallback(async () => {
    const version = ++fingerprintRequestVersion.current;
    setLoadingFingerprintStatus(true);
    try {
      const response = await getLibraryAssistantFingerprintStatus();
      if (version !== fingerprintRequestVersion.current) return;
      setFingerprintStatus(response);
      setFingerprintStatusError(null);
    } catch (error) {
      if (version !== fingerprintRequestVersion.current) return;
      setFingerprintStatus(null);
      setFingerprintStatusError(error instanceof Error ? error.message : 'Não foi possível verificar o Chromaprint.');
    } finally {
      if (version === fingerprintRequestVersion.current) setLoadingFingerprintStatus(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadLibraryCounts();
    void loadPolicy();
    void loadFingerprintStatus();
    void loadLocalLyricsCapability();
    void loadAutonomy();
    return () => {
      requestVersion.current += 1;
      policyRequestVersion.current += 1;
      fingerprintRequestVersion.current += 1;
    };
  }, [load, loadAutonomy, loadFingerprintStatus, loadLibraryCounts, loadLocalLyricsCapability, loadPolicy]);

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

  useEffect(() => {
    setSelected(new Set());
    setActiveSuggestionId(null);
    setSuggestionPage(1);
  }, [filter, latestRun?.id, policy, search]);

  useEffect(() => {
    if (suggestionPage > suggestionPageCount) setSuggestionPage(suggestionPageCount);
  }, [suggestionPage, suggestionPageCount]);

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

  async function analyze(target: LibraryAssistantAnalysisTarget, full = false) {
    if (analyzing || mutating || runActive) return;
    setAnalysisMenuOpen(false);
    setAnalyzing(true);
    setFeedback(null);
    try {
      const started = await startLibraryAssistantAnalysis(target, { full });
      setRuns(current => [
        ...started.runs,
        ...current.filter(item => !started.runs.some(run => run.id === item.id))
      ]);
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
      const started = await startLibraryAssistantAnalysis('all', { full: true });
      setRuns(current => [
        ...started.runs,
        ...current.filter(item => !started.runs.some(run => run.id === item.id))
      ]);
      setProgress(EMPTY_PROGRESS);
      setSuggestions([]);
      setReviewItems([]);
      setSelected(new Set());
      setFeedback({
        kind: 'success',
        message: `${invalidated.toLocaleString('pt-BR')} sugestão${invalidated === 1 ? '' : 'ões'} aberta${invalidated === 1 ? '' : 's'} descartada${invalidated === 1 ? '' : 's'}. Reanálise completa de toda a biblioteca iniciada.`
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
    if (activeRuns.length === 0) return;
    setMutating(true);
    try {
      await cancelLibraryAssistantRun(activeRuns[0].id);
      setFeedback({
        kind: 'warning',
        message: 'Análise cancelada. Sugestões abertas desses processamentos foram invalidadas.'
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
    const artworkDecision = suggestion.target.capability === 'artwork';
    setMutating(true);
    setFeedback(null);
    if (artworkDecision) {
      setSuggestionErrors(current => {
        if (!(suggestion.id in current)) return current;
        const next = { ...current };
        delete next[suggestion.id];
        return next;
      });
    }
    try {
      const { result } = await decideLibraryAssistantSuggestion(decision);
      if (result.outcome === 'applied') {
        notifyLibraryChanged();
        setFeedback({
          kind: 'success',
          message: suggestion.target.capability === 'artwork'
            ? 'Capa aplicada pelo override existente.'
            : suggestion.target.capability === 'lyrics'
              ? 'Letra aprovada e aplicada. O player já usa a nova resolução sem rescan.'
              : 'Sugestão aplicada. A biblioteca foi atualizada sem rescan.'
        });
      } else if (result.outcome === 'rejected') {
        setFeedback({ kind: 'success', message: 'Sugestão rejeitada e mantida no histórico da análise.' });
      } else if (result.outcome === 'already-applied' || result.outcome === 'already-rejected') {
        setFeedback({ kind: 'success', message: 'Esta sugestão já havia sido resolvida. A revisão foi atualizada.' });
      } else if (result.outcome === 'stale') {
        setFeedback({ kind: 'warning', message: result.message ?? 'A sugestão ficou desatualizada. Analise novamente.' });
      } else {
        const message = result.message ?? 'A decisão não pôde ser concluída.';
        if (artworkDecision) {
          setSuggestionErrors(current => ({ ...current, [suggestion.id]: message }));
        } else {
          setFeedback({ kind: 'error', message });
        }
      }
      await load(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'A decisão não pôde ser concluída.';
      if (artworkDecision) {
        setSuggestionErrors(current => ({ ...current, [suggestion.id]: message }));
      } else {
        setFeedback({ kind: 'error', message });
      }
    } finally {
      setMutating(false);
    }
  }

  async function identifyByAudio(suggestion: LibraryAssistantSuggestion) {
    if (!canTryFingerprint(suggestion) || fingerprintingId || !fingerprintStatus?.fpcalc.available) return;
    setFingerprintingId(suggestion.id);
    setFeedback(null);
    try {
      const result = await fingerprintLibraryAssistantSuggestion(suggestion.runId, suggestion.id);
      if (!result.externalLookup) {
        setFeedback({
          kind: 'success',
          message: result.cacheHit
            ? 'Fingerprint local reutilizado do cache. AcoustID está desativado; nenhum dado foi enviado externamente.'
            : 'Fingerprint local gerado. AcoustID está desativado; nenhum dado foi enviado externamente.'
        });
      } else if (!result.identified) {
        setFeedback({
          kind: 'warning',
          message: 'Fingerprint gerado, mas o AcoustID não encontrou uma gravação confiável para esta faixa.'
        });
      } else if (result.ambiguous) {
        setFeedback({
          kind: 'warning',
          message: 'O áudio aponta para múltiplas gravações próximas. As novas sugestões foram mantidas em revisão.'
        });
      } else if (result.conflict) {
        setFeedback({
          kind: 'warning',
          message: 'O áudio encontrou uma gravação, mas há conflito com a metadata ou evidência atual. Nada foi aplicado automaticamente.'
        });
      } else {
        setFeedback({
          kind: 'success',
          message: `${result.suggestionIds.length.toLocaleString('pt-BR')} sugestão${result.suggestionIds.length === 1 ? '' : 'ões'} reforçada${result.suggestionIds.length === 1 ? '' : 's'} pela identificação do áudio e adicionada${result.suggestionIds.length === 1 ? '' : 's'} para revisão.`
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

  async function applySuggestions(
    chosen: LibraryAssistantSuggestion[],
    reviewConfirmed = false
  ) {
    if (mutating) return;
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

  async function applySelected(reviewConfirmed = false) {
    const chosen = suggestions.filter(item => (
      selected.has(item.id)
      && canApplyInBatch(item)
      && reviewMap.has(item.id)
    ));
    await applySuggestions(chosen, reviewConfirmed);
  }


  async function updatePolicyMode(key: LibraryAssistantReviewPolicyKey, mode: LibraryAssistantReviewMode) {
    if (!policyReady || savingPolicy || mutating || (key === 'artwork' && mode === 'bulk')) return;
    const previous = policy;
    const next = { ...policy, [key]: mode } as LibraryAssistantReviewPolicy;
    const version = ++policyRequestVersion.current;
    setPolicy(next);
    setSavingPolicy(true);
    setFeedback(null);
    try {
      const response = await updateLibraryAssistantReviewPolicy(next);
      if (version !== policyRequestVersion.current) return;
      setPolicy(response.policy);
      setFeedback({ kind: 'success', message: 'Política de revisão atualizada.' });
    } catch (error) {
      if (version !== policyRequestVersion.current) return;
      setPolicy(previous);
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Não foi possível salvar a política de revisão.'
      });
    } finally {
      if (version === policyRequestVersion.current) setSavingPolicy(false);
    }
  }

  async function toggleAutonomy() {
    if (savingAutonomy || !autonomy) return;
    const nextEnabled = !autonomy.config.enabled;
    if (
      nextEnabled
      && !window.confirm(
        'Ativar automação segura?\n\nO Home Music poderá analisar mudanças em segundo plano e preencher automaticamente apenas campos de metadata vazios quando a sugestão tiver alta confiança. Capas, letras e campos já preenchidos continuam fora da aplicação automática.'
      )
    ) return;

    setSavingAutonomy(true);
    setAutonomyError(null);
    try {
      const response = await updateLibraryAssistantAutonomy(nextEnabled);
      setAutonomy(response);
      setFeedback({
        kind: 'success',
        message: nextEnabled
          ? 'Automação segura ativada para campos de metadata vazios.'
          : 'Automação segura desativada.'
      });
    } catch (error) {
      setAutonomyError(error instanceof Error ? error.message : 'Não foi possível atualizar a automação segura.');
    } finally {
      setSavingAutonomy(false);
    }
  }

  const totalChecks = progress.total;
  const processedChecks = Math.min(progress.processed, totalChecks);
  const progressPercent = totalChecks > 0
    ? Math.min(processedChecks < totalChecks ? 99 : 100, Math.round((processedChecks / totalChecks) * 100))
    : 0;
  const pendingChecks = progress.pending + progress.processing;
  const processingFailureCount = progress.failed;
  const failedRun = analysisRuns.some(run => run.status === 'failed');
  const metadataProgress = metadataRun ? runProgress[metadataRun.id] ?? null : null;
  const artworkProgress = artworkRun ? runProgress[artworkRun.id] ?? null : null;
  const lyricsProgress = lyricsRun ? runProgress[lyricsRun.id] ?? null : null;
  const retryStatus = retryLabel(lyricsProgress) ?? retryLabel(artworkProgress) ?? retryLabel(metadataProgress);
  const failedSuggestionCount = reviewableSuggestions.filter(item => item.status === 'failed').length;
  const activeTypeCounts = {
    metadata: reviewableSuggestions.filter(item => item.target.capability === 'metadata').length,
    artwork: reviewableSuggestions.filter(item => item.target.capability === 'artwork').length,
    lyrics: reviewableSuggestions.filter(item => item.target.capability === 'lyrics').length
  };

  const applyActiveTrackSuggestions = async () => {
    const chosen = activeTrackSuggestions.filter(item => (
      selected.has(item.id) && canApplyInBatch(item) && reviewMap.has(item.id)
    ));
    await applySuggestions(chosen);
  };

  return (
    <section className="assistant-admin assistant-admin--prototype" aria-labelledby="library-assistant-title">
      <header className="assistant-v2__header">
        <button className="assistant-v2__back" type="button" aria-label="Voltar" onClick={onBack}>
          <ChevronLeft />
        </button>
        <div className="assistant-v2__heading">
          <strong id="library-assistant-title">Assistente da Biblioteca</strong>
          <span>Encontre e corrija metadados, capas e letras de forma segura.</span>
        </div>
        <div className="assistant-v2__header-actions">
          <button
            type="button"
            className={section === 'settings' ? 'is-active' : undefined}
            onClick={() => setSection(value => value === 'settings' ? 'suggestions' : 'settings')}
          >
            <Settings /> Configurações
          </button>
          <button
            type="button"
            className="assistant-v2__icon-button"
            aria-label="Como funciona o Assistente"
            aria-pressed={showHelp}
            onClick={() => setShowHelp(value => !value)}
          >
            <HelpCircle />
          </button>
        </div>
      </header>

      {showHelp && (
        <aside className="assistant-v2__help" role="note">
          <Info />
          <div>
            <strong>Correções reversíveis e protegidas</strong>
            <span>O Assistente compara sua biblioteca com fontes confiáveis, separa sugestões seguras das que exigem revisão e aplica mudanças como overrides. Os arquivos originais permanecem intactos.</span>
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
              <ul>{feedback.details.map(detail => <li key={detail}>{detail}</li>)}</ul>
            </details>
          )}
        </div>
      )}

      {section === 'settings' ? (
        <section className="assistant-admin__operations-panel assistant-v2__settings-panel" aria-labelledby="assistant-settings-title">
          <header className="assistant-admin__operations-heading">
            <div>
              <strong id="assistant-settings-title">Configurações</strong>
              <small>Controle o que aparece para revisão e quais sugestões seguras podem entrar em lote.</small>
            </div>
            <button className="assistant-v2__close-settings" type="button" onClick={() => setSection('suggestions')}><X /> Fechar</button>
          </header>

          <div className="assistant-admin__settings">
            <strong>Política de revisão</strong>
            <p className="assistant-admin__settings-note">Ocultar apenas tira sugestões abertas da lista visível; Revisar individualmente mantém a decisão manual; Permitir lote seguro reúne somente sugestões de alta confiança. Capas continuam individuais.</p>
            <div className="assistant-admin__policy-list">
              {POLICY_ROWS.map(row => {
                const modes = row.allowBulk ? POLICY_MODES : POLICY_MODES.filter(([mode]) => mode !== 'bulk');
                return (
                  <fieldset key={row.key} className="assistant-admin__policy-field" disabled={!policyReady || savingPolicy || mutating}>
                    <legend>{row.label}</legend>
                    <p>{row.description}</p>
                    <div className="assistant-admin__policy-options">
                      {modes.map(([mode, label]) => (
                        <label key={mode} className="assistant-admin__policy-option">
                          <input
                            type="radio"
                            name={`assistant-policy-${row.key}`}
                            value={mode}
                            checked={policy[row.key] === mode}
                            onChange={() => void updatePolicyMode(row.key, mode)}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>

          <div className="assistant-admin__settings assistant-admin__settings--action">
            <div>
              <strong>Automação segura</strong>
              <p className="assistant-admin__settings-note">Quando ativada, mudanças na biblioteca podem iniciar uma análise em segundo plano. Somente campos de metadata vazios e sugestões de alta confiança podem ser preenchidos automaticamente.</p>
              <span className={`assistant-admin__settings-status ${autonomy?.config.enabled ? 'is-ready' : ''}`}>
                {autonomyError
                  ? autonomyError
                  : autonomy == null
                    ? 'Carregando estado…'
                    : autonomy.config.enabled
                      ? 'Ativada · somente metadata ausente'
                      : 'Desativada'}
              </span>
            </div>
            <button className="assistant-admin__secondary-button" type="button" disabled={!autonomy || savingAutonomy} onClick={() => void toggleAutonomy()}>
              {savingAutonomy ? <LoaderCircle className="is-spinning" /> : <ShieldCheck />}
              {autonomy?.config.enabled ? 'Desativar' : 'Ativar'}
            </button>
          </div>

          <div className="assistant-admin__settings">
            <strong>Identificação por áudio</strong>
            <p className="assistant-admin__settings-note">
              {loadingFingerprintStatus
                ? 'Verificando Chromaprint e AcoustID…'
                : fingerprintStatus
                  ? `Chromaprint: ${fingerprintStatus.fpcalc.available ? 'disponível' : fingerprintIssueLabel(fingerprintStatus.fpcalc.issue)}. AcoustID: ${fingerprintStatus.acoustIdEnabled ? fingerprintStatus.acoustIdConfigured ? 'habilitado' : 'sem chave configurada' : 'desativado'}.`
                  : fingerprintStatusError ?? 'Não foi possível verificar a identificação por áudio.'}
            </p>
          </div>

          {onOpenLocalLyrics && (
            <div className="assistant-admin__settings assistant-admin__settings--action">
              <div>
                <strong>Lyrics local</strong>
                <p className="assistant-admin__settings-note">Fallback opcional com Whisper. O áudio permanece neste servidor e o resultado sempre volta para revisão.</p>
              </div>
              <button className="assistant-admin__secondary-button" type="button" disabled={!localLyricsCapability?.available} onClick={onOpenLocalLyrics}>
                <Music2 /> Abrir lyrics local
              </button>
            </div>
          )}

          <div className="assistant-admin__settings">
            <strong>Reanálise completa</strong>
            <p className="assistant-admin__settings-note">Use apenas quando quiser descartar sugestões abertas e refazer a análise de toda a biblioteca.</p>
            <button className="assistant-admin__danger-button assistant-v2__reanalyze" type="button" disabled={runActive || analyzing || mutating} onClick={() => setConfirmReset(true)}>
              <RefreshCw /> Reanalisar toda a biblioteca
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className={`assistant-v2__hero ${failedRun ? 'is-error' : ''}`} aria-label="Estado da análise">
            <div className="assistant-v2__hero-summary">
              <div className="assistant-v2__hero-title">
                <span className="assistant-v2__hero-icon"><Music2 /></span>
                <div>
                  <strong>{runTitle(statusRun)}</strong>
                  <small>{runActive ? 'A biblioteca está sendo analisada. Você já pode revisar resultados prontos.' : 'A biblioteca foi analisada. Revise as sugestões abaixo.'}</small>
                </div>
              </div>

              <div className="assistant-v2__hero-numbers">
                <div><strong>{libraryCounts.total.toLocaleString('pt-BR')}</strong><span>faixas na biblioteca</span></div>
                <div className="is-success"><strong>{reviewableSuggestions.length.toLocaleString('pt-BR')}</strong><span>sugestões abertas</span></div>
                <div><strong>{processingFailureCount.toLocaleString('pt-BR')}</strong><span>falhas de processamento</span></div>
              </div>

              <div className="assistant-v2__progress">
                <div><span style={{ width: `${progressPercent}%` }} /></div>
                <strong>{progressPercent}%</strong>
              </div>

              <div className="assistant-v2__micro-status">
                <span className="is-success"><CheckCircle2 /> {processedChecks.toLocaleString('pt-BR')} verificações concluídas</span>
                <span><Clock3 /> {pendingChecks.toLocaleString('pt-BR')} aguardando processamento</span>
                <span className="is-warning"><AlertTriangle /> {progress.retry.toLocaleString('pt-BR')} aguardando nova tentativa</span>
                <span className="is-error"><XCircle /> {processingFailureCount.toLocaleString('pt-BR')} falhas definitivas</span>
                {retryStatus && <span className="is-warning"><Clock3 /> {retryStatus}</span>}
              </div>
            </div>

            <div className="assistant-v2__process-card">
              <strong><CheckCircle2 /> {runActive ? 'Processamento em andamento' : 'Processamento finalizado'}</strong>
              <div className="assistant-v2__process-row">
                <span><Music2 /> Metadados</span>
                <small>{progressLabel(metadataProgress, metadataRun)}</small>
                {metadataRun?.status === 'completed' ? <CheckCircle2 /> : metadataRun?.status === 'failed' ? <XCircle /> : <Clock3 />}
              </div>
              <div className="assistant-v2__process-row">
                <span><ImageIcon /> Capas</span>
                <small>{progressLabel(artworkProgress, artworkRun)}</small>
                {artworkRun?.status === 'completed' ? <CheckCircle2 /> : artworkRun?.status === 'failed' ? <XCircle /> : <Clock3 />}
              </div>
              <div className="assistant-v2__process-row assistant-v2__process-row--lyrics">
                <span><FileText /> Letras</span>
                <small>{progressLabel(lyricsProgress, lyricsRun)}</small>
                {lyricsRun?.status === 'completed' ? <CheckCircle2 /> : lyricsRun?.status === 'failed' ? <XCircle /> : <Clock3 />}
                {lyricsProgress && lyricsProgress.retry > 0 && (
                  <em>{lyricsProgress.retry.toLocaleString('pt-BR')} aguardando nova tentativa{retryLabel(lyricsProgress) ? ` · ${retryLabel(lyricsProgress)}` : ''}</em>
                )}
                {lyricsProgress && lyricsProgress.failed > 0 && (
                  <em className="is-error">{lyricsProgress.failed.toLocaleString('pt-BR')} falha{lyricsProgress.failed === 1 ? '' : 's'} definitiva{lyricsProgress.failed === 1 ? '' : 's'}</em>
                )}
              </div>
            </div>

            <div className="assistant-v2__analysis-actions">
              {runActive ? (
                <button className="assistant-admin__danger-button" type="button" disabled={mutating} onClick={() => void cancelAnalysis()}>
                  <X /> Cancelar análise
                </button>
              ) : (
                <div className="assistant-v2__analyze-menu">
                  <button
                    className="assistant-v2__analyze"
                    type="button"
                    disabled={analyzing || mutating}
                    aria-expanded={analysisMenuOpen}
                    onClick={() => setAnalysisMenuOpen(value => !value)}
                  >
                    {analyzing ? <LoaderCircle className="is-spinning" /> : <Sparkles />} Escolher análise <ChevronDown />
                  </button>
                  {analysisMenuOpen && (
                    <div className="assistant-v2__analyze-options" role="menu">
                      {ANALYSIS_ACTIONS.map(([target, label, description]) => (
                        <button key={target} type="button" role="menuitem" onClick={() => void analyze(target, false)}>
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <small>Execute apenas o tipo de correção que você quer revisar.</small>
              <span>Última execução</span>
              <strong>{statusRun ? formatRunDate(statusRun.createdAt) : 'Ainda não executada'}</strong>
              <button className="assistant-v2__reanalyze-inline" type="button" disabled={runActive || analyzing || mutating} onClick={() => setConfirmReset(true)}>
                <RefreshCw /> Reanalisar tudo
              </button>
              <small>Força uma nova análise de toda a biblioteca.</small>
            </div>
          </section>

          <section className="assistant-v2__summary-grid" aria-label="Resumo das sugestões">
            <div><Music2 /><span><strong>{reviewableSuggestions.length.toLocaleString('pt-BR')}</strong><small>sugestões encontradas</small><em>{visibleSuggestions.length.toLocaleString('pt-BR')} visíveis pela política</em></span></div>
            <div className="is-safe"><ShieldCheck /><span><strong>{safeSuggestions.length.toLocaleString('pt-BR')}</strong><small>sugestões seguras</small><em>Podem ser aplicadas em lote</em></span></div>
            <div className="is-review"><AlertTriangle /><span><strong>{reviewSuggestions.length.toLocaleString('pt-BR')}</strong><small>precisam de revisão</small><em>Exigem sua decisão</em></span></div>
            <div className="is-error"><XCircle /><span><strong>{processingFailureCount.toLocaleString('pt-BR')}</strong><small>falhas de processamento</small><em>Não entram na fila de sugestões</em></span></div>
            <div className="assistant-v2__safe-apply">
              <span>Aplicar sugestões seguras</span>
              <button type="button" disabled={mutating || safeSuggestions.length === 0} onClick={() => void applySuggestions(safeSuggestions)}>
                {batching ? <LoaderCircle className="is-spinning" /> : <CheckCircle2 />} Aplicar {safeSuggestions.length.toLocaleString('pt-BR')} sugestões
              </button>
            </div>
          </section>

          <section className="assistant-v2__suggestions">
            <nav className="assistant-v2__filters" aria-label="Filtros das sugestões">
              {([
                ['all', `Sugestões (${reviewableSuggestions.length})`],
                ['metadata', `Metadados (${activeTypeCounts.metadata})`],
                ['artwork', `Capas (${activeTypeCounts.artwork})`],
                ['lyrics', `Letras (${activeTypeCounts.lyrics})`],
                ['review', `Revisão (${reviewSuggestions.length})`],
                ['failed', `Falhas de sugestão (${failedSuggestionCount})`]
              ] as const).map(([value, label]) => (
                <button key={value} type="button" className={filter === value ? 'is-active' : undefined} onClick={() => setFilter(value)}>{label}</button>
              ))}
            </nav>

            <div className="assistant-v2__toolbar">
              <label>
                <Search />
                <input
                  type="search"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Buscar por título, artista, álbum, faixa, capa ou letra..."
                  aria-label="Buscar sugestões"
                />
              </label>
              <label className="assistant-v2__sort">
                <select value={sort} onChange={event => setSort(event.target.value as Sort)} aria-label="Ordenar sugestões">
                  <option value="recent">Mais recentes</option>
                  <option value="oldest">Mais antigas</option>
                </select>
                <ChevronDown />
              </label>
            </div>

            <div className="assistant-v2__workspace">
              <div className="assistant-v2__table">
                <div className="assistant-v2__table-head">
                  <span></span><span>Música</span><span>Tipo</span><span>Sugestão</span><span>Confiança</span><span>Status</span><span></span>
                </div>

                {loading && visibleSuggestions.length === 0 ? (
                  <div className="assistant-v2__empty"><LoaderCircle className="is-spinning" /><span>Carregando sugestões…</span></div>
                ) : visibleSuggestions.length === 0 ? (
                  <div className="assistant-v2__empty"><Search /><span>Nenhuma sugestão neste filtro.</span></div>
                ) : (
                  <div className="assistant-v2__table-body">
                    {pagedVisibleSuggestions.map(suggestion => {
                      const item = reviewMap.get(suggestion.id);
                      const safe = isBatchSafe(suggestion);
                      const selectedRow = activeSuggestion?.id === suggestion.id;
                      const type = suggestion.target.capability === 'metadata' ? 'Metadados' : suggestion.target.capability === 'artwork' ? 'Capa' : 'Letra';
                      const suggestionText = suggestion.target.capability === 'metadata'
                        ? FIELD_LABELS[suggestion.target.field]
                        : suggestion.target.capability === 'artwork'
                          ? 'Nova capa'
                          : suggestion.target.synchronized ? 'Letra sincronizada' : 'Letra';
                      const confidence = suggestion.confidence === 'high' ? 'Alta' : suggestion.confidence === 'medium' ? 'Média' : 'Baixa';
                      return (
                        <button
                          type="button"
                          key={suggestion.id}
                          className={`assistant-v2__table-row ${selectedRow ? 'is-selected' : ''}`}
                          onClick={() => setActiveSuggestionId(suggestion.id)}
                        >
                          <span className="assistant-v2__checkbox" onClick={event => event.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(suggestion.id)}
                              disabled={!canApplyInBatch(suggestion)}
                              aria-label={`Selecionar ${item?.track.title ?? suggestion.target.trackId}`}
                              onChange={event => setSelected(current => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(suggestion.id); else next.delete(suggestion.id);
                                return next;
                              })}
                            />
                          </span>
                          <span className="assistant-v2__song">
                            {suggestion.target.capability === 'artwork'
                              ? <AssistantSuggestedArtwork runId={suggestion.runId} suggestionId={suggestion.id} />
                              : <AssistantTrackArtwork trackId={suggestion.target.trackId} />}
                            <span><strong>{item?.track.title ?? 'Faixa da biblioteca'}</strong><small>{item?.track.artist ?? '—'} · {item?.track.album ?? '—'}</small></span>
                          </span>
                          <span><i className={`assistant-v2__type is-${suggestion.target.capability}`}>{type}</i></span>
                          <span className="assistant-v2__suggestion-kind">{suggestionText}</span>
                          <span><i className={`assistant-v2__confidence is-${suggestion.confidence}`}>{confidence}</i></span>
                          <span><i className={`assistant-v2__status ${safe ? 'is-safe' : suggestion.status === 'failed' ? 'is-error' : 'is-review'}`}>
                            {safe ? <CheckCircle2 /> : suggestion.status === 'failed' ? <XCircle /> : <AlertTriangle />}
                            {safe ? 'Segura' : suggestion.status === 'failed' ? 'Falha' : 'Revisão'}
                          </i></span>
                          <ChevronRight />
                        </button>
                      );
                    })}
                  </div>
                )}

                <footer className="assistant-v2__table-footer">
                  <span>{visibleSuggestions.length.toLocaleString('pt-BR')} sugestões</span>
                  <div>
                    <span>50 por página</span>
                    <button type="button" aria-label="Página anterior" disabled={suggestionPage <= 1} onClick={() => setSuggestionPage(value => Math.max(1, value - 1))}><ChevronLeft /></button>
                    <button type="button" className="is-active">{suggestionPage}</button>
                    {suggestionPageCount > 1 && <span>de {suggestionPageCount}</span>}
                    <button type="button" aria-label="Próxima página" disabled={suggestionPage >= suggestionPageCount} onClick={() => setSuggestionPage(value => Math.min(suggestionPageCount, value + 1))}><ChevronRight /></button>
                  </div>
                </footer>
              </div>

              <aside className="assistant-v2__inspector">
                {!activeSuggestion || !activeReviewItem ? (
                  <div className="assistant-v2__inspector-empty">
                    <Sparkles />
                    <strong>Selecione uma sugestão</strong>
                    <span>Veja a mudança proposta e decida o que deve ser aplicado.</span>
                  </div>
                ) : (
                  <>
                    <header className="assistant-v2__track-header">
                      <AssistantTrackArtwork trackId={activeSuggestion.target.trackId} />
                      <div>
                        <strong>{activeReviewItem.track.title}</strong>
                        <span>{activeReviewItem.track.artist}</span>
                        <small>{activeReviewItem.track.album}</small>
                      </div>
                    </header>

                    <nav className="assistant-v2__inspector-tabs">
                      <button type="button" className="is-active">Sugestões ({activeTrackSuggestions.length})</button>
                      <button type="button">Informações</button>
                    </nav>

                    <div className="assistant-v2__suggestion-cards">
                      {activeTrackSuggestions.map(suggestion => {
                        const canDecide = Boolean(reviewMap.has(suggestion.id) && expectedCurrentValue(suggestion) != null && isOpen(suggestion));
                        const canFingerprint = canTryFingerprint(suggestion);
                        return (
                          <article key={suggestion.id}>
                            <header>
                              <label>
                                <input
                                  type="checkbox"
                                  checked={selected.has(suggestion.id)}
                                  disabled={!canApplyInBatch(suggestion)}
                                  onChange={event => setSelected(current => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(suggestion.id); else next.delete(suggestion.id);
                                    return next;
                                  })}
                                />
                                <strong>{capabilityLabel(suggestion)}</strong>
                              </label>
                              {canDecide && (
                                <div className="assistant-v2__card-actions">
                                  {suggestion.target.capability === 'artwork' && (
                                    <button
                                      className="assistant-v2__apply-individual"
                                      type="button"
                                      disabled={mutating}
                                      onClick={() => void decideOne(suggestion, 'apply')}
                                    >
                                      <Check /> Aplicar capa
                                    </button>
                                  )}
                                  <button type="button" disabled={mutating} onClick={() => void decideOne(suggestion, 'reject')}>Rejeitar</button>
                                </div>
                              )}
                            </header>

                            {suggestion.target.capability === 'metadata' ? (
                              <div className="assistant-v2__change">
                                <div><span>{suggestion.target.currentValue || '—'}</span><small>Valor atual</small></div>
                                <ChevronRight />
                                <div><span>{suggestion.target.suggestedValue}</span><small>Sugestão ({provenanceLabel(suggestion.provenance.source)})</small></div>
                              </div>
                            ) : suggestion.target.capability === 'artwork' ? (
                              <>
                                <div className="assistant-v2__artwork-change">
                                  <div>
                                    <AssistantTrackArtwork trackId={suggestion.target.trackId} />
                                    <small>Capa atual</small>
                                  </div>
                                  <ChevronRight />
                                  <div>
                                    <AssistantSuggestedArtwork runId={suggestion.runId} suggestionId={suggestion.id} />
                                    <small>Capa sugerida</small>
                                  </div>
                                </div>
                                {suggestionErrors[suggestion.id] && (
                                  <p className="assistant-v2__suggestion-error" role="alert">
                                    <AlertTriangle />
                                    <span>{suggestionErrors[suggestion.id]}</span>
                                  </p>
                                )}
                                <p className="assistant-v2__candidate">{rowDetail(suggestion, reviewMap.get(suggestion.id))}</p>
                              </>
                            ) : (
                              <p className="assistant-v2__candidate">{rowDetail(suggestion, reviewMap.get(suggestion.id))}</p>
                            )}

                            <footer>
                              <span className={`assistant-v2__confidence is-${suggestion.confidence}`}>
                                Confiança: {suggestion.confidence === 'high' ? 'Alta' : suggestion.confidence === 'medium' ? 'Média' : 'Baixa'}
                              </span>
                              {canFingerprint && (
                                <button
                                  type="button"
                                  className="assistant-v2__fingerprint"
                                  disabled={mutating || Boolean(fingerprintingId) || !fingerprintStatus?.fpcalc.available}
                                  onClick={() => void identifyByAudio(suggestion)}
                                >
                                  <Fingerprint /> {fingerprintingId === suggestion.id ? 'Identificando…' : 'Identificar pelo áudio'}
                                </button>
                              )}
                            </footer>
                          </article>
                        );
                      })}
                    </div>

                    {activeTrackSuggestions.some(canApplyInBatch) ? (
                      <div className="assistant-v2__inspector-actions">
                        <button
                          className="assistant-v2__apply-track"
                          type="button"
                          disabled={mutating || activeTrackSelectedCount === 0}
                          onClick={() => void applyActiveTrackSuggestions()}
                        >
                          <Check /> Aplicar {activeTrackSelectedCount || activeTrackSuggestions.filter(canApplyInBatch).length} sugestões
                        </button>
                        <button
                          type="button"
                          disabled={mutating || activeTrackSelectedCount === 0}
                          onClick={() => void Promise.all(activeTrackSuggestions.filter(item => selected.has(item.id)).map(item => decideOne(item, 'reject')))}
                        >
                          <X /> Rejeitar selecionadas
                        </button>
                      </div>
                    ) : (
                      <p className="assistant-v2__individual-note">
                        <Info /> Capas são aplicadas individualmente depois de conferir a imagem sugerida.
                      </p>
                    )}

                    <p className="assistant-v2__override-note"><Info /> As alterações são aplicadas como overrides e não modificam os arquivos originais.</p>
                  </>
                )}
              </aside>
            </div>
          </section>
        </>
      )}

      {confirmReviewCount > 0 && (
        <div className="assistant-admin__confirm-backdrop">
          <section className="assistant-admin__confirm" role="dialog" aria-modal="true" aria-labelledby="assistant-confirm-review-title">
            <h2 id="assistant-confirm-review-title">Aplicar sugestões em Revisão?</h2>
            <p>A seleção contém {confirmReviewCount.toLocaleString('pt-BR')} sugestão{confirmReviewCount === 1 ? '' : 'ões'} que exige{confirmReviewCount === 1 ? '' : 'm'} revisão humana. O servidor continuará validando o estado atual antes de aplicar cada item.</p>
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
            <h2 id="assistant-confirm-reset-title">Reanalisar toda a biblioteca?</h2>
            <p>As sugestões abertas serão marcadas como desatualizadas e todas as faixas serão analisadas novamente. Aplicadas, rejeitadas e o histórico serão preservados.</p>
            <div className="assistant-admin__confirm-actions">
              <button autoFocus className="assistant-admin__secondary-button" type="button" onClick={() => setConfirmReset(false)}>Cancelar</button>
              <button className="assistant-admin__danger-button" type="button" onClick={() => void resetAndAnalyze()}><RefreshCw /> Reanalisar tudo</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
