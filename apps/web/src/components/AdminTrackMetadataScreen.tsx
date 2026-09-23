import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AdminLibraryOverviewResponse,
  AdminTrack,
  AdminTrackCoverResponse,
  AdminTrackMetadataResponse,
  EditableTrackMetadata
} from '@home-music/shared';
import type { MissingCoverFillJob } from '@home-music/shared/library-assistant';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Music2,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Upload,
  X
} from 'lucide-react';
import { adminCoverUrl, validateAdminCoverFile } from '../admin-track-cover';
import { getAdminLibraryOverview } from '../admin-library-client';
import { buildTrackMetadataOverridePatch } from '../admin-track-metadata';
import {
  generateAdminTrackCover,
  getAdminTrackCover,
  getAdminTrackMetadata,
  listAdminTracks,
  resetAdminTrackCover,
  resetAdminTrackMetadata,
  updateAdminTrackCover,
  updateAdminTrackMetadata
} from '../admin-tracks-client';
import {
  getMissingCoverFillJob,
  startMissingCoverFillJob
} from '../library-assistant-client';
import { notifyLibraryChanged } from '../library-events';
import { ArtworkFallback } from './Artwork';

type AdminMetadataHealthFilter = {
  label: string;
  trackIds: string[];
};

type AdminTrackMetadataScreenProps = {
  onBack: () => void;
  initialHealthFilter?: AdminMetadataHealthFilter | null;
  onHealthFilterCleared?: () => void;
};

type EditorFeedback = {
  message: string;
  error: boolean;
};

type SavingAction = 'text-save' | 'text-reset' | 'cover-save' | 'cover-reset' | 'cover-generate' | null;
type MetadataFilter = 'all' | 'missingTitle' | 'missingCover' | 'unknownArtist' | 'unknownAlbum';

const PAGE_SIZE = 50;

const FILTER_LABELS: Record<MetadataFilter, string> = {
  all: 'Todas',
  missingTitle: 'Sem título',
  missingCover: 'Sem capa',
  unknownArtist: 'Artista desconhecido',
  unknownAlbum: 'Álbum desconhecido'
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value)} ${units[exponent]}`;
}

function applyEffectiveMetadata(track: AdminTrack, metadata: AdminTrackMetadataResponse): AdminTrack {
  if (track.id !== metadata.trackId) return track;
  return { ...track, ...metadata.effective, metadataOverrideActive: Boolean(metadata.override.updatedAt) };
}

function applyEffectiveCover(track: AdminTrack, cover: AdminTrackCoverResponse): AdminTrack {
  if (track.id !== cover.trackId) return track;
  return {
    ...track,
    hasCover: cover.effectiveHasCover,
    coverVersion: cover.override?.version,
    coverOverrideActive: Boolean(cover.override)
  };
}

function hasOverride(metadata: AdminTrackMetadataResponse | null) {
  return Boolean(metadata?.override.updatedAt);
}

function metadataChanged(metadata: AdminTrackMetadataResponse | null, draft: EditableTrackMetadata | null) {
  if (!metadata || !draft) return false;
  return (
    metadata.effective.title !== draft.title
    || metadata.effective.artist !== draft.artist
    || metadata.effective.album !== draft.album
    || metadata.effective.albumArtist !== draft.albumArtist
  );
}

function filterFromLabel(label: string | null | undefined): MetadataFilter | null {
  const normalized = label?.trim().toLocaleLowerCase('pt-BR') ?? '';
  if (normalized.includes('sem título')) return 'missingTitle';
  if (normalized.includes('sem capa')) return 'missingCover';
  if (normalized.includes('artista desconhecido')) return 'unknownArtist';
  if (normalized.includes('álbum desconhecido')) return 'unknownAlbum';
  return null;
}

function trackCoverUrl(track: AdminTrack) {
  if (!track.hasCover) return null;
  const version = track.coverVersion ? `?v=${encodeURIComponent(track.coverVersion)}` : '';
  return `/api/tracks/${encodeURIComponent(track.id)}/cover${version}`;
}

function pageNumbers(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const values = new Set([1, total, current - 1, current, current + 1]);
  return [...values].filter(value => value >= 1 && value <= total).sort((a, b) => a - b);
}

export function AdminTrackMetadataScreen({
  onBack,
  initialHealthFilter = null,
  onHealthFilterCleared
}: AdminTrackMetadataScreenProps) {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [overview, setOverview] = useState<AdminLibraryOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MetadataFilter>(filterFromLabel(initialHealthFilter?.label) ?? 'all');
  const [fallbackHealthFilter, setFallbackHealthFilter] = useState<AdminMetadataHealthFilter | null>(
    filterFromLabel(initialHealthFilter?.label) ? null : initialHealthFilter
  );
  const [page, setPage] = useState(1);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<AdminTrackMetadataResponse | null>(null);
  const [cover, setCover] = useState<AdminTrackCoverResponse | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableTrackMetadata | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorFeedback, setEditorFeedback] = useState<EditorFeedback | null>(null);
  const [savingAction, setSavingAction] = useState<SavingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [coverFillJob, setCoverFillJob] = useState<MissingCoverFillJob | null>(null);
  const [coverFillError, setCoverFillError] = useState<string | null>(null);
  const editorRequestRef = useRef(0);
  const handledCoverFillJobRef = useRef<string | null>(null);
  const operationBusy = savingAction !== null;
  const editorDirty = Boolean(coverFile) || metadataChanged(metadata, draft);

  const problemTrackIds = useMemo(() => {
    const result: Partial<Record<MetadataFilter, Set<string>>> = {};
    if (overview) {
      result.missingTitle = new Set(overview.problems.trackIds.missingTitle);
      result.missingCover = new Set(overview.problems.trackIds.missingCover);
      result.unknownArtist = new Set(overview.problems.trackIds.unknownArtist);
      result.unknownAlbum = new Set(overview.problems.trackIds.unknownAlbum);
    }
    if (fallbackHealthFilter) result.all = new Set(fallbackHealthFilter.trackIds);
    return result;
  }, [fallbackHealthFilter, overview]);

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return tracks.filter(track => {
      if (fallbackHealthFilter && !problemTrackIds.all?.has(track.id)) return false;
      if (!fallbackHealthFilter && filter !== 'all' && !problemTrackIds[filter]?.has(track.id)) return false;
      if (!normalized) return true;
      return [track.title, track.artist, track.album, track.folder]
        .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized));
    });
  }, [fallbackHealthFilter, filter, problemTrackIds, query, tracks]);

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / PAGE_SIZE));
  const visibleTracks = useMemo(
    () => filteredTracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredTracks, page]
  );
  const editingTrack = useMemo(
    () => tracks.find(track => track.id === editingTrackId) ?? null,
    [editingTrackId, tracks]
  );
  const missingCoverCount = overview?.problems.missingCover ?? tracks.filter(track => !track.hasCover).length;
  const coverFillRunning = coverFillJob?.status === 'running';
  const pagination = pageNumbers(page, pageCount);

  useEffect(() => {
    const mapped = filterFromLabel(initialHealthFilter?.label);
    if (mapped) {
      setFilter(mapped);
      setFallbackHealthFilter(null);
    } else {
      setFallbackHealthFilter(initialHealthFilter);
      if (initialHealthFilter) setFilter('all');
    }
  }, [initialHealthFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [filter, fallbackHealthFilter, query]);

  useEffect(() => {
    if (!coverFile) {
      setCoverPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  useEffect(() => {
    if (!editingTrackId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || operationBusy) return;
      closeEditor();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingTrackId, editorDirty, operationBusy]);

  async function loadTracks(background = false) {
    if (!background) setLoading(true);
    setError(null);
    try {
      const [tracksResponse, overviewResponse] = await Promise.all([
        listAdminTracks(),
        getAdminLibraryOverview()
      ]);
      setTracks(tracksResponse.tracks);
      setOverview(overviewResponse);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      if (!background) setLoading(false);
    }
  }

  useEffect(() => {
    void loadTracks();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getMissingCoverFillJob()
      .then(response => {
        if (!cancelled) setCoverFillJob(response.job);
      })
      .catch(caught => {
        if (!cancelled) setCoverFillError(errorMessage(caught));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!coverFillRunning) return;
    const timer = window.setInterval(() => {
      void getMissingCoverFillJob()
        .then(response => {
          setCoverFillJob(response.job);
          setCoverFillError(null);
        })
        .catch(caught => setCoverFillError(errorMessage(caught)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [coverFillRunning]);

  useEffect(() => {
    if (!coverFillJob || coverFillJob.status === 'running') return;
    if (handledCoverFillJobRef.current === coverFillJob.id) return;
    handledCoverFillJobRef.current = coverFillJob.id;
    if (coverFillJob.status === 'completed') {
      notifyLibraryChanged();
      void loadTracks(true);
    }
  }, [coverFillJob]);

  async function startCoverFill() {
    if (coverFillRunning) return;
    setCoverFillError(null);
    setFeedback(null);
    try {
      const response = await startMissingCoverFillJob();
      setCoverFillJob(response.job);
    } catch (caught) {
      setCoverFillError(errorMessage(caught));
    }
  }

  function coverFillStatusText(job: MissingCoverFillJob) {
    if (job.status === 'failed') return job.error ?? 'O preenchimento de capas foi interrompido.';
    if (job.status === 'completed') {
      return `${job.externalFound.toLocaleString('pt-BR')} reais · ${job.generated.toLocaleString('pt-BR')} geradas · ${job.failed.toLocaleString('pt-BR')} falhas`;
    }
    if (job.phase === 'searching') {
      return `Buscando capas reais · ${job.searched.toLocaleString('pt-BR')} de ${job.total.toLocaleString('pt-BR')}`;
    }
    if (job.phase === 'applying') return `Aplicando ${job.externalFound.toLocaleString('pt-BR')} capas reais encontradas…`;
    return 'Gerando capas para o que não foi encontrado…';
  }

  function confirmEditorDiscard() {
    return !editorDirty || window.confirm('Descartar as alterações ainda não salvas desta música?');
  }

  function clearEditor() {
    editorRequestRef.current += 1;
    setEditingTrackId(null);
    setMetadata(null);
    setCover(null);
    setCoverFile(null);
    setDraft(null);
    setEditorFeedback(null);
    setEditorLoading(false);
  }

  async function openEditor(track: AdminTrack) {
    if (operationBusy || editorLoading || editingTrackId === track.id) return;
    if (editingTrackId && !confirmEditorDiscard()) return;

    const requestId = editorRequestRef.current + 1;
    editorRequestRef.current = requestId;
    setEditingTrackId(track.id);
    setMetadata(null);
    setCover(null);
    setCoverFile(null);
    setDraft(null);
    setEditorFeedback(null);
    setEditorLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const [loadedMetadata, loadedCover] = await Promise.all([
        getAdminTrackMetadata(track.id),
        getAdminTrackCover(track.id)
      ]);
      if (editorRequestRef.current !== requestId) return;
      setMetadata(loadedMetadata);
      setCover(loadedCover);
      setDraft(loadedMetadata.effective);
    } catch (caught) {
      if (editorRequestRef.current !== requestId) return;
      setError(errorMessage(caught));
      clearEditor();
    } finally {
      if (editorRequestRef.current === requestId) setEditorLoading(false);
    }
  }

  function closeEditor() {
    if (operationBusy || !confirmEditorDiscard()) return;
    clearEditor();
  }

  function leaveScreen() {
    if (operationBusy || !confirmEditorDiscard()) return;
    onBack();
  }

  function setField(field: keyof EditableTrackMetadata, value: string) {
    setDraft(current => current ? { ...current, [field]: value } : current);
    setEditorFeedback(null);
  }

  function selectCoverFile(file: File | null) {
    if (!file || operationBusy) return;
    try {
      validateAdminCoverFile(file);
      setCoverFile(file);
      setEditorFeedback(null);
    } catch (caught) {
      setCoverFile(null);
      setEditorFeedback({ message: errorMessage(caught), error: true });
    }
  }

  function commitMetadata(updated: AdminTrackMetadataResponse, message: string) {
    setMetadata(updated);
    setDraft(updated.effective);
    setTracks(items => items.map(track => applyEffectiveMetadata(track, updated)));
    setFeedback(message);
    setEditorFeedback({ message, error: false });
    notifyLibraryChanged();
  }

  function commitCover(updated: AdminTrackCoverResponse, message: string) {
    setCover(updated);
    setCoverFile(null);
    setTracks(items => items.map(track => applyEffectiveCover(track, updated)));
    setFeedback(message);
    setEditorFeedback({ message, error: false });
    notifyLibraryChanged();
  }

  async function saveMetadata() {
    if (!metadata || !draft || operationBusy) return;
    setSavingAction('text-save');
    setEditorFeedback(null);
    try {
      const patch = buildTrackMetadataOverridePatch(metadata.physical, draft);
      const updated = await updateAdminTrackMetadata(metadata.trackId, patch);
      commitMetadata(updated, 'Metadados salvos como override. O arquivo original não foi alterado.');
      void loadTracks(true);
    } catch (caught) {
      setEditorFeedback({ message: errorMessage(caught), error: true });
    } finally {
      setSavingAction(null);
    }
  }

  async function resetMetadata() {
    if (!metadata || operationBusy || !hasOverride(metadata)) return;
    if (!window.confirm('Restaurar os metadados exibidos para os valores do arquivo original?\n\nO arquivo físico não será modificado.')) return;
    setSavingAction('text-reset');
    setEditorFeedback(null);
    try {
      const updated = await resetAdminTrackMetadata(metadata.trackId);
      commitMetadata(updated, 'Overrides de texto removidos. A biblioteca voltou a exibir os metadados do arquivo.');
      void loadTracks(true);
    } catch (caught) {
      setEditorFeedback({ message: errorMessage(caught), error: true });
    } finally {
      setSavingAction(null);
    }
  }

  async function generateCover() {
    if (!editingTrackId || !cover || cover.effectiveHasCover || coverFile || operationBusy) return;
    setSavingAction('cover-generate');
    setEditorFeedback(null);
    try {
      const updated = await generateAdminTrackCover(editingTrackId);
      commitCover(updated, 'Capa gerada materializada como override local. O arquivo de áudio original não foi alterado.');
      void loadTracks(true);
    } catch (caught) {
      setEditorFeedback({ message: errorMessage(caught), error: true });
    } finally {
      setSavingAction(null);
    }
  }

  async function saveCover() {
    if (!editingTrackId || !coverFile || operationBusy) return;
    setSavingAction('cover-save');
    setEditorFeedback(null);
    try {
      validateAdminCoverFile(coverFile);
      const updated = await updateAdminTrackCover(editingTrackId, coverFile);
      commitCover(updated, 'Capa salva como override. O arquivo de áudio original não foi alterado.');
      void loadTracks(true);
    } catch (caught) {
      setEditorFeedback({ message: errorMessage(caught), error: true });
    } finally {
      setSavingAction(null);
    }
  }

  async function resetCover() {
    if (!editingTrackId || !cover?.override || operationBusy) return;
    if (!window.confirm('Remover o override de capa e voltar à capa do arquivo original?\n\nO arquivo de áudio não será modificado.')) return;
    setSavingAction('cover-reset');
    setEditorFeedback(null);
    try {
      const updated = await resetAdminTrackCover(editingTrackId);
      commitCover(
        updated,
        updated.physicalHasCover
          ? 'Override de capa removido. A capa do arquivo voltou a ser exibida.'
          : 'Override de capa removido. O arquivo original não possui capa.'
      );
      void loadTracks(true);
    } catch (caught) {
      setEditorFeedback({ message: errorMessage(caught), error: true });
    } finally {
      setSavingAction(null);
    }
  }

  const persistedCoverUrl = editingTrackId && cover ? adminCoverUrl(editingTrackId, cover) : null;
  const displayedCoverUrl = coverPreviewUrl ?? persistedCoverUrl;
  const selectedHasOverride = Boolean(metadata?.override.updatedAt || cover?.override);

  const selectFilter = (next: MetadataFilter) => {
    if (operationBusy || (editorDirty && !confirmEditorDiscard())) return;
    clearEditor();
    setFallbackHealthFilter(null);
    onHealthFilterCleared?.();
    setFilter(next);
  };

  const clearFallbackFilter = () => {
    if (operationBusy || (editorDirty && !confirmEditorDiscard())) return;
    clearEditor();
    setFallbackHealthFilter(null);
    onHealthFilterCleared?.();
    setFilter('all');
  };

  return (
    <section className="my-account-screen admin-metadata-screen admin-metadata-screen--v2" aria-labelledby="admin-metadata-title">
      <header className="admin-metadata-v2__page-header">
        <button className="admin-metadata-v2__back" type="button" aria-label="Voltar" disabled={operationBusy} onClick={leaveScreen}><ChevronLeft /></button>
        <div>
          <strong id="admin-metadata-title">Metadados</strong>
          <small>Correções reversíveis de texto e capa. Os arquivos originais permanecem intactos.</small>
        </div>
        <div className="admin-metadata-v2__summary">
          <span><Music2 /></span>
          <div>
            <strong>{tracks.length.toLocaleString('pt-BR')} faixas</strong>
            <small>{missingCoverCount.toLocaleString('pt-BR')} sem capa</small>
          </div>
        </div>
      </header>

      <div className="admin-metadata-v2">
        <div className="admin-metadata-v2__top">
          <label className="admin-metadata-v2__search">
            <Search />
            <input
              type="search"
              value={query}
              disabled={operationBusy}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar título, artista, álbum ou pasta..."
              aria-label="Buscar músicas para editar metadados"
            />
          </label>

          <section className="admin-metadata-v2__cover-fill-card">
            <div>
              <strong>Capas</strong>
              <span>{missingCoverCount.toLocaleString('pt-BR')} músicas ainda não possuem uma capa física.</span>
            </div>
            <button
              type="button"
              disabled={loading || coverFillRunning}
              onClick={() => void startCoverFill()}
            >
              {coverFillRunning ? <LoaderCircle className="is-spinning" /> : <Sparkles />}
              Preencher capas ausentes
            </button>
          </section>
        </div>

        <nav className="admin-metadata-v2__filters" aria-label="Filtrar problemas de metadados">
          {(Object.keys(FILTER_LABELS) as MetadataFilter[]).map(key => {
            const count = key === 'all'
              ? tracks.length
              : key === 'missingTitle'
                ? overview?.problems.missingTitle ?? 0
                : key === 'missingCover'
                  ? overview?.problems.missingCover ?? missingCoverCount
                  : key === 'unknownArtist'
                    ? overview?.problems.unknownArtist ?? 0
                    : overview?.problems.unknownAlbum ?? 0;
            const active = !fallbackHealthFilter && filter === key;
            return (
              <button type="button" key={key} className={active ? 'is-active' : ''} disabled={operationBusy} onClick={() => selectFilter(key)}>
                {FILTER_LABELS[key]} <span>{count.toLocaleString('pt-BR')}</span>
              </button>
            );
          })}
          {fallbackHealthFilter && (
            <button type="button" className="is-active is-custom" onClick={clearFallbackFilter}>
              {fallbackHealthFilter.label} <span>{fallbackHealthFilter.trackIds.length.toLocaleString('pt-BR')}</span> <X />
            </button>
          )}
        </nav>

        {coverFillJob && (
          <div className={`admin-metadata-v2__cover-progress ${coverFillJob.status === 'failed' ? 'is-error' : coverFillJob.status === 'completed' ? 'is-success' : ''}`} role="status">
            <div>
              {coverFillRunning ? <LoaderCircle className="is-spinning" /> : coverFillJob.status === 'completed' ? <CheckCircle2 /> : <Sparkles />}
              <span>
                <strong>{coverFillRunning ? 'Preenchendo capas' : coverFillJob.status === 'completed' ? 'Capas atualizadas' : 'Preenchimento interrompido'}</strong>
                <small>{coverFillStatusText(coverFillJob)}</small>
              </span>
            </div>
            {coverFillRunning && coverFillJob.total > 0 && (
              <progress max={coverFillJob.total} value={coverFillJob.searched} />
            )}
          </div>
        )}

        {coverFillError && <div className="admin-tracks-message is-error" role="alert">{coverFillError}</div>}
        {error && <div className="admin-tracks-message is-error" role="alert">{error}</div>}
        {feedback && <div className="admin-tracks-message is-success" role="status">{feedback}</div>}

        <div className="admin-metadata-v2__workspace">
          <section className="admin-metadata-v2__list" aria-label="Músicas com metadados editáveis">
            {loading ? (
              <div className="admin-metadata-v2__state" role="status"><LoaderCircle className="is-spinning" /> Carregando músicas…</div>
            ) : filteredTracks.length === 0 ? (
              <div className="admin-metadata-v2__state"><Music2 /> Nenhuma música encontrada neste filtro.</div>
            ) : (
              <>
                <div className="admin-metadata-v2__rows">
                  {visibleTracks.map(track => {
                    const selected = editingTrackId === track.id;
                    const coverUrl = trackCoverUrl(track);
                    const overrideActive = Boolean(track.metadataOverrideActive || track.coverOverrideActive);
                    return (
                      <button
                        className={`admin-metadata-v2__row ${selected ? 'is-selected' : ''}`}
                        type="button"
                        key={track.id}
                        aria-pressed={selected}
                        disabled={operationBusy || editorLoading}
                        onClick={() => void openEditor(track)}
                      >
                        <span className="admin-metadata-v2__thumb">
                          {coverUrl
                            ? <img src={coverUrl} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
                            : <ArtworkFallback track={track} />}
                        </span>
                        <span className="admin-metadata-v2__row-copy">
                          <strong>{track.title}</strong>
                          <small>{track.artist} · {track.album}</small>
                          <small>{track.folder}</small>
                        </span>
                        <span className={`admin-metadata-v2__row-state ${overrideActive ? 'is-override' : !track.hasCover ? 'is-missing' : 'is-clean'}`}>
                          <i />
                          {overrideActive ? 'Override ativo' : !track.hasCover ? 'Sem capa' : 'Sem overrides'}
                        </span>
                        <span className="admin-metadata-v2__row-open"><Pencil /></span>
                      </button>
                    );
                  })}
                </div>

                <footer className="admin-metadata-v2__pagination">
                  <span>{filteredTracks.length.toLocaleString('pt-BR')} músicas</span>
                  <div>
                    <span className="admin-metadata-v2__page-size">50 por página</span>
                    <button type="button" aria-label="Página anterior" disabled={page <= 1 || operationBusy} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
                    {pagination.map((value, index) => {
                      const previous = pagination[index - 1];
                      return (
                        <span className="admin-metadata-v2__page-slot" key={value}>
                          {previous && value - previous > 1 && <i>…</i>}
                          <button type="button" className={value === page ? 'is-active' : ''} onClick={() => setPage(value)}>{value}</button>
                        </span>
                      );
                    })}
                    <button type="button" aria-label="Próxima página" disabled={page >= pageCount || operationBusy} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
                  </div>
                </footer>
              </>
            )}
          </section>

          <aside className="admin-metadata-v2__inspector" aria-labelledby="admin-metadata-editor-title">
            {!editingTrackId ? (
              <div className="admin-metadata-v2__inspector-empty">
                <span><Pencil /></span>
                <strong id="admin-metadata-editor-title">Selecione uma música</strong>
                <small>Veja e corrija texto e capa sem alterar o arquivo original.</small>
              </div>
            ) : editorLoading || !metadata || !draft || !cover ? (
              <div className="admin-metadata-v2__inspector-loading" role="status">
                <LoaderCircle className="is-spinning" />
                <span><strong id="admin-metadata-editor-title">Carregando metadados</strong><small>{editingTrack?.title ?? 'Música selecionada'}</small></span>
              </div>
            ) : (
              <form className="admin-metadata-v2__editor" onSubmit={event => { event.preventDefault(); void saveMetadata(); }}>
                <header className="admin-metadata-v2__inspector-header">
                  <strong>Detalhes da música</strong>
                  <button type="button" aria-label="Fechar edição de metadados" disabled={operationBusy} onClick={closeEditor}><X /></button>
                </header>

                <section className="admin-metadata-v2__identity">
                  <span className="admin-metadata-v2__identity-cover">
                    {displayedCoverUrl
                      ? <img src={displayedCoverUrl} alt="" />
                      : <ArtworkFallback track={editingTrack ?? undefined} />}
                  </span>
                  <div>
                    <strong id="admin-metadata-editor-title">{draft.title}</strong>
                    <span>{draft.artist}</span>
                    <small>{draft.album}</small>
                    <span className={`admin-metadata-v2__override-badge ${selectedHasOverride ? 'is-override' : ''}`}>
                      {selectedHasOverride ? <Circle /> : <CheckCircle2 />}
                      {selectedHasOverride ? 'Override ativo' : 'Sem overrides'}
                    </span>
                    {!selectedHasOverride && <small>Os metadados exibidos são os mesmos do arquivo original.</small>}
                  </div>
                </section>

                {editorFeedback && (
                  <div className={`admin-metadata-v2__editor-message ${editorFeedback.error ? 'is-error' : 'is-success'}`} role={editorFeedback.error ? 'alert' : 'status'}>
                    {editorFeedback.message}
                  </div>
                )}

                <section className="admin-metadata-v2__metadata-section">
                  <div className="admin-metadata-v2__section-title">
                    <strong>Metadados</strong>
                    <span className={metadataChanged(metadata, draft) ? 'is-changed' : ''}>
                      <CheckCircle2 /> {metadataChanged(metadata, draft) ? 'Alterações pendentes' : 'Igual ao original'}
                    </span>
                  </div>

                  <div className="admin-metadata-v2__fields">
                    <label className="is-wide">
                      <span>Título</span>
                      <input aria-label="Título" autoFocus required maxLength={240} value={draft.title} disabled={operationBusy} onChange={event => setField('title', event.target.value)} />
                      <small>Original: {metadata.physical.title}</small>
                    </label>
                    <label>
                      <span>Artista</span>
                      <input aria-label="Artista" required maxLength={240} value={draft.artist} disabled={operationBusy} onChange={event => setField('artist', event.target.value)} />
                      <small>Original: {metadata.physical.artist}</small>
                    </label>
                    <label>
                      <span>Álbum</span>
                      <input aria-label="Álbum" required maxLength={240} value={draft.album} disabled={operationBusy} onChange={event => setField('album', event.target.value)} />
                      <small>Original: {metadata.physical.album}</small>
                    </label>
                    <label className="is-wide">
                      <span>Artista do álbum</span>
                      <input aria-label="Artista do álbum" required maxLength={240} value={draft.albumArtist} disabled={operationBusy} onChange={event => setField('albumArtist', event.target.value)} />
                      <small>Original: {metadata.physical.albumArtist}</small>
                    </label>
                  </div>

                  <div className="admin-metadata-v2__text-actions">
                    <button className="admin-metadata-reset" type="button" disabled={operationBusy || !hasOverride(metadata)} onClick={() => void resetMetadata()}>
                      {savingAction === 'text-reset' ? <LoaderCircle className="is-spinning" /> : <RotateCcw />} Restaurar valores originais
                    </button>
                    <button className="admin-metadata-save" type="submit" disabled={operationBusy || !metadataChanged(metadata, draft)}>
                      {savingAction === 'text-save' ? <LoaderCircle className="is-spinning" /> : <Save />} Salvar alterações
                    </button>
                  </div>
                </section>

                <section className="admin-metadata-v2__cover-section">
                  <strong>Capa</strong>
                  <div className="admin-metadata-v2__cover-content">
                    <div className={`admin-metadata-v2__cover-preview ${displayedCoverUrl ? '' : 'is-fallback'}`}>
                      {displayedCoverUrl
                        ? <img src={displayedCoverUrl} alt={`Preview da capa de ${draft.title}`} />
                        : <ArtworkFallback track={editingTrack ?? undefined} />}
                    </div>
                    <div className="admin-metadata-v2__cover-body">
                      <div className="admin-metadata-v2__cover-description">
                        <strong>
                          {coverFile
                            ? 'Nova imagem selecionada'
                            : cover.override
                              ? 'Override de capa ativo'
                              : cover.physicalHasCover
                                ? 'Usando a capa embutida no arquivo.'
                                : 'O arquivo original não possui capa.'}
                        </strong>
                        <small>
                          {coverFile
                            ? `${coverFile.name} · ${formatBytes(coverFile.size)}`
                            : cover.override
                              ? `${cover.override.width}×${cover.override.height} · ${formatBytes(cover.override.sizeBytes)}`
                              : cover.physicalHasCover
                                ? 'Esta é a capa original da música.'
                                : 'Você pode usar a capa gerada ou selecionar uma imagem.'}
                        </small>
                      </div>

                      <div className="admin-metadata-v2__cover-actions">
                        <label className={`admin-cover-upload ${operationBusy ? 'is-disabled' : ''}`}>
                          <ImageIcon /> {coverFile ? 'Trocar imagem' : 'Selecionar nova imagem'}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={operationBusy}
                            onChange={event => {
                              const file = event.currentTarget.files?.[0] ?? null;
                              event.currentTarget.value = '';
                              selectCoverFile(file);
                            }}
                          />
                        </label>
                        {!cover.effectiveHasCover && !coverFile && (
                          <button className="admin-cover-save" type="button" disabled={operationBusy} onClick={() => void generateCover()}>
                            {savingAction === 'cover-generate' ? <LoaderCircle className="is-spinning" /> : <Sparkles />} Usar capa gerada
                          </button>
                        )}
                        {coverFile && (
                          <button className="admin-cover-save" type="button" disabled={operationBusy} onClick={() => void saveCover()}>
                            {savingAction === 'cover-save' ? <LoaderCircle className="is-spinning" /> : <Upload />} Salvar capa
                          </button>
                        )}
                        {cover.override && (
                          <button className="admin-cover-reset" type="button" disabled={operationBusy} onClick={() => void resetCover()}>
                            {savingAction === 'cover-reset' ? <LoaderCircle className="is-spinning" /> : <RotateCcw />} Restaurar capa original
                          </button>
                        )}
                      </div>

                      <div className="admin-metadata-v2__cover-hint">
                        <Info />
                        <span>Imagens em JPEG, PNG ou WebP. Máximo de 8 MiB (até 4096×4096).</span>
                      </div>
                    </div>
                  </div>
                </section>
              </form>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
