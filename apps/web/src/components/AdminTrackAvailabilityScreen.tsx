import { useEffect, useMemo, useState } from 'react';
import type { AdminTrack, AdminTrackFileLocation, AdminTrackMoveResponse } from '@home-music/shared';
import {
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Clock3,
  Copy,
  Disc3,
  FileAudio2,
  Folder,
  FolderOpen,
  Gauge,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Music2,
  Search,
  Trash2,
  X
} from 'lucide-react';
import { runAdminBatch, summarizeAdminBatch } from '../admin-batch';
import { quarantineAdminTrack } from '../admin-quarantine-client';
import {
  getAdminTrackLocation,
  listAdminTracks,
  setAdminTrackEnabled
} from '../admin-tracks-client';
import { notifyLibraryChanged } from '../library-events';
import { useAdminBulkSelection } from '../useAdminBulkSelection';
import { AdminBulkToolbar } from './AdminBulkToolbar';
import { AdminTrackMoveDialog } from './AdminTrackMoveDialog';

type AdminTrackAvailabilityScreenProps = {
  onBack: () => void;
};

type AvailabilityFilter = 'all' | 'active' | 'inactive';
type BatchFeedback = { message: string; error: boolean };

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function formatDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 'Indisponível';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function pageNumbers(current: number, total: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const values = new Set([1, total, current - 1, current, current + 1]);
  return [...values].filter(value => value >= 1 && value <= total).sort((a, b) => a - b);
}

function trackCoverUrl(track: AdminTrack) {
  const version = track.coverVersion ? `?v=${encodeURIComponent(track.coverVersion)}` : '';
  return `/api/tracks/${encodeURIComponent(track.id)}/cover${version}`;
}

export function AdminTrackAvailabilityScreen({ onBack }: AdminTrackAvailabilityScreenProps) {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [movingTrack, setMovingTrack] = useState<AdminTrack | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<AdminTrackFileLocation | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchFeedback, setBatchFeedback] = useState<BatchFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AvailabilityFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZE_OPTIONS)[number]>(50);

  const counts = useMemo(() => {
    const active = tracks.filter(track => track.enabled).length;
    return { active, inactive: tracks.length - active };
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    return tracks.filter(track => {
      if (filter === 'active' && !track.enabled) return false;
      if (filter === 'inactive' && track.enabled) return false;
      if (!normalized) return true;
      return [track.title, track.artist, track.album, track.folder, track.folderPath, track.format]
        .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized));
    });
  }, [filter, query, tracks]);

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / pageSize));
  const visibleTracks = useMemo(
    () => filteredTracks.slice((page - 1) * pageSize, page * pageSize),
    [filteredTracks, page, pageSize]
  );
  const selection = useAdminBulkSelection(tracks, visibleTracks);
  const selectedActiveTracks = useMemo(
    () => selection.selectedItems.filter(track => track.enabled),
    [selection.selectedItems]
  );
  const selectedInactiveTracks = useMemo(
    () => selection.selectedItems.filter(track => !track.enabled),
    [selection.selectedItems]
  );
  const selectedTrack = useMemo(
    () => tracks.find(track => track.id === selectedTrackId) ?? null,
    [selectedTrackId, tracks]
  );
  const operationBusy = batchBusy || busyTrackId !== null || movingTrack !== null;

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [filter, query, pageSize]);

  useEffect(() => {
    if (loading || visibleTracks.length === 0) {
      if (!loading) setSelectedTrackId(null);
      return;
    }
    if (!selectedTrackId || !visibleTracks.some(track => track.id === selectedTrackId)) {
      setSelectedTrackId(visibleTracks[0].id);
    }
  }, [loading, selectedTrackId, visibleTracks]);

  useEffect(() => {
    if (!selectedTrack) {
      setSelectedLocation(null);
      setLocationError(null);
      setLocationLoading(false);
      return;
    }

    let active = true;
    setSelectedLocation(null);
    setLocationError(null);
    setLocationLoading(true);
    void getAdminTrackLocation(selectedTrack.id)
      .then(location => {
        if (active) setSelectedLocation(location);
      })
      .catch(caught => {
        if (active) setLocationError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLocationLoading(false);
      });
    return () => { active = false; };
  }, [selectedTrack]);

  async function loadTracks() {
    setLoading(true);
    setError(null);
    try {
      const response = await listAdminTracks();
      setTracks(response.tracks);
      setSelectedTrackId(current => (
        current && response.tracks.some(track => track.id === current)
          ? current
          : response.tracks[0]?.id ?? null
      ));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTracks(); }, []);

  async function toggleTrack(track: AdminTrack) {
    if (operationBusy) return;
    setBusyTrackId(track.id);
    setError(null);
    setBatchFeedback(null);
    try {
      const updated = await setAdminTrackEnabled(track.id, !track.enabled);
      setTracks(items => items.map(item => item.id === updated.id ? updated : item));
      notifyLibraryChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyTrackId(null);
    }
  }

  async function moveToTrash(track: AdminTrack) {
    if (operationBusy) return;
    if (!window.confirm(`Mover “${track.title}” para a lixeira?\n\nO arquivo poderá ser restaurado depois.`)) return;

    setBusyTrackId(track.id);
    setError(null);
    setBatchFeedback(null);
    try {
      await quarantineAdminTrack(track.id);
      setTracks(items => items.filter(item => item.id !== track.id));
      if (selectedTrackId === track.id) setSelectedTrackId(null);
      notifyLibraryChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyTrackId(null);
    }
  }

  function organizeTrack(track: AdminTrack) {
    if (operationBusy) return;
    setError(null);
    setBatchFeedback(null);
    setMovingTrack(track);
  }

  function commitMove(response: AdminTrackMoveResponse) {
    setTracks(items => items.map(item => item.id === response.track.id ? response.track : item));
    setMovingTrack(null);
    setSelectedTrackId(response.track.id);
    selection.clear();
    setBatchFeedback({
      message: response.moved
        ? `Organização: arquivo movido para “${response.location.relativePath}”.`
        : 'Organização: o arquivo já estava no destino informado.',
      error: false
    });
    notifyLibraryChanged();
  }

  async function runTrackBatch(
    label: string,
    items: AdminTrack[],
    operation: (track: AdminTrack) => Promise<unknown>,
    onSucceeded: (succeeded: AdminTrack[]) => void
  ) {
    if (operationBusy || items.length === 0) return;
    setBatchBusy(true);
    setBatchProgress({ completed: 0, total: items.length });
    setBatchFeedback(null);
    setError(null);
    try {
      const result = await runAdminBatch(items, operation, {
        concurrency: 4,
        onProgress: (completed, total) => setBatchProgress({ completed, total })
      });
      onSucceeded(result.succeeded);
      selection.retain(result.failed.map(failure => failure.item.id));
      setBatchFeedback({
        message: summarizeAdminBatch(label, result),
        error: result.failed.length > 0
      });
      if (result.succeeded.length > 0) notifyLibraryChanged();
    } finally {
      setBatchBusy(false);
    }
  }

  async function setSelectedEnabled(enabled: boolean) {
    const eligible = enabled ? selectedInactiveTracks : selectedActiveTracks;
    const label = enabled ? 'Reativação' : 'Desativação';
    await runTrackBatch(
      label,
      eligible,
      track => setAdminTrackEnabled(track.id, enabled),
      succeeded => {
        const ids = new Set(succeeded.map(track => track.id));
        setTracks(items => items.map(item => ids.has(item.id) ? { ...item, enabled } : item));
      }
    );
  }

  async function quarantineSelected() {
    if (selection.selectedItems.length === 0 || operationBusy) return;
    const count = selection.selectedItems.length;
    if (!window.confirm(
      `Mover ${count} ${count === 1 ? 'música' : 'músicas'} para a lixeira?\n\nOs arquivos poderão ser restaurados depois.`
    )) return;

    await runTrackBatch(
      'Lixeira',
      selection.selectedItems,
      track => quarantineAdminTrack(track.id),
      succeeded => {
        const ids = new Set(succeeded.map(track => track.id));
        setTracks(items => items.filter(item => !ids.has(item.id)));
        if (selectedTrackId && ids.has(selectedTrackId)) setSelectedTrackId(null);
      }
    );
  }

  const pagination = pageNumbers(page, pageCount);

  return (
    <section className="my-account-screen admin-tracks-screen admin-tracks-screen--v4" aria-labelledby="admin-tracks-title">
      <header className="admin-tracks-v4__page-header">
        <button className="admin-tracks-v4__back" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-tracks-title">Gerenciar músicas</strong>
          <small>Controle a disponibilidade e organização das faixas da sua biblioteca.</small>
        </div>
        <div className="admin-tracks-v4__summary">
          <span className="admin-tracks-v4__summary-icon"><Music2 /></span>
          <div>
            <strong>{tracks.length.toLocaleString('pt-BR')} faixas</strong>
            <small>{counts.active.toLocaleString('pt-BR')} ativas · {counts.inactive.toLocaleString('pt-BR')} desativadas</small>
          </div>
        </div>
      </header>

      <div className="admin-tracks-v4">
        <section className="admin-tracks-v4__controls" aria-label="Filtros de músicas">
          <label className="admin-tracks-v4__search">
            <Search />
            <input
              type="search"
              value={query}
              disabled={operationBusy}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar título, artista, álbum ou pasta..."
              aria-label="Buscar músicas"
            />
          </label>
          <div className="admin-tracks-v4__filters" role="group" aria-label="Filtrar disponibilidade">
            <button type="button" disabled={operationBusy} className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
              Todas <span>{tracks.length.toLocaleString('pt-BR')}</span>
            </button>
            <button type="button" disabled={operationBusy} className={filter === 'active' ? 'is-active' : ''} onClick={() => setFilter('active')}>
              Ativas <span>{counts.active.toLocaleString('pt-BR')}</span>
            </button>
            <button type="button" disabled={operationBusy} className={filter === 'inactive' ? 'is-active' : ''} onClick={() => setFilter('inactive')}>
              Desativadas <span>{counts.inactive.toLocaleString('pt-BR')}</span>
            </button>
          </div>
        </section>

        {error && <div className="admin-tracks-message is-error" role="alert">{error}</div>}
        {batchFeedback && (
          <div className={`admin-tracks-message ${batchFeedback.error ? 'is-error' : 'is-success'}`} role={batchFeedback.error ? 'alert' : 'status'}>
            {batchFeedback.message}
          </div>
        )}

        {loading ? (
          <div className="admin-tracks-v4__state" role="status"><LoaderCircle className="is-spinning" /> Carregando músicas…</div>
        ) : filteredTracks.length === 0 ? (
          <div className="admin-tracks-v4__state"><Music2 /> Nenhuma música encontrada com estes filtros.</div>
        ) : (
          <div className="admin-tracks-v4__workspace">
            <section className="admin-tracks-v4__list" aria-label="Músicas administráveis">
              <div className="admin-tracks-v4__rows">
                {visibleTracks.map(track => {
                  const bulkSelected = selection.selectedIds.has(track.id);
                  const inspected = selectedTrackId === track.id;
                  return (
                    <article
                      className={`admin-track-row admin-track-row--v4${track.enabled ? '' : ' is-disabled'}${bulkSelected ? ' is-selected' : ''}${inspected ? ' is-inspected' : ''}`}
                      key={track.id}
                    >
                      <input
                        className="admin-track-row__select"
                        type="checkbox"
                        checked={bulkSelected}
                        disabled={operationBusy}
                        aria-label={`Selecionar ${track.title}`}
                        onChange={() => selection.toggle(track.id)}
                      />
                      <button
                        className="admin-track-row__cover-button"
                        type="button"
                        onClick={() => setSelectedTrackId(track.id)}
                        aria-label={`Ver detalhes de ${track.title}`}
                      >
                        <span className="admin-track-row__cover">
                          {track.hasCover
                            ? <img src={trackCoverUrl(track)} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
                            : <Music2 />}
                        </span>
                      </button>
                      <button className="admin-track-row__body-button" type="button" onClick={() => setSelectedTrackId(track.id)}>
                        <span className="admin-track-row__body">
                          <strong>{track.title}</strong>
                          <small>{track.artist} · {track.album}</small>
                          <small className="admin-track-row__folder">{track.folder}</small>
                        </span>
                      </button>
                      <span className={`admin-track-row__status ${track.enabled ? 'is-active' : ''}`}>
                        <i /> {track.enabled ? 'Ativa' : 'Desativada'}
                      </span>
                      <button
                        className="admin-track-row__more"
                        type="button"
                        disabled={operationBusy}
                        aria-label={`Abrir detalhes de ${track.title}`}
                        onClick={() => setSelectedTrackId(track.id)}
                      >
                        <MoreHorizontal />
                      </button>
                    </article>
                  );
                })}
              </div>

              <footer className="admin-tracks-v4__pagination">
                <span>{filteredTracks.length.toLocaleString('pt-BR')} faixas encontradas</span>
                <div className="admin-tracks-v4__pagination-controls">
                  <label>
                    <select
                      aria-label="Faixas por página"
                      value={pageSize}
                      disabled={operationBusy}
                      onChange={event => setPageSize(Number(event.target.value) as (typeof PAGE_SIZE_OPTIONS)[number])}
                    >
                      {PAGE_SIZE_OPTIONS.map(size => <option key={size} value={size}>{size} por página</option>)}
                    </select>
                  </label>
                  <button type="button" aria-label="Página anterior" disabled={page <= 1 || operationBusy} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
                  {pagination.map((value, index) => {
                    const previous = pagination[index - 1];
                    return (
                      <span className="admin-tracks-v4__page-slot" key={value}>
                        {previous && value - previous > 1 && <i>…</i>}
                        <button
                          type="button"
                          className={value === page ? 'is-active' : ''}
                          disabled={operationBusy}
                          aria-label={`Página ${value}`}
                          onClick={() => setPage(value)}
                        >{value}</button>
                      </span>
                    );
                  })}
                  <button type="button" aria-label="Próxima página" disabled={page >= pageCount || operationBusy} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
                </div>
              </footer>
            </section>

            <aside className="admin-tracks-v4__inspector" aria-label="Detalhes da faixa">
              {!selectedTrack ? (
                <div className="admin-tracks-v4__inspector-empty">
                  <Music2 />
                  <strong>Selecione uma faixa</strong>
                  <span>Os detalhes e ações administrativas aparecerão aqui.</span>
                </div>
              ) : (
                <>
                  <header className="admin-tracks-v4__inspector-header">
                    <strong>Detalhes da faixa</strong>
                    <button type="button" aria-label="Fechar detalhes" onClick={() => setSelectedTrackId(null)}><X /></button>
                  </header>

                  <section className="admin-tracks-v4__identity">
                    <span className="admin-tracks-v4__identity-cover">
                      {selectedTrack.hasCover
                        ? <img src={trackCoverUrl(selectedTrack)} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
                        : <Music2 />}
                    </span>
                    <div>
                      <strong>{selectedTrack.title}</strong>
                      <span>{selectedTrack.artist}</span>
                      <small>{selectedTrack.album}</small>
                      <span className={`admin-tracks-v4__identity-status ${selectedTrack.enabled ? 'is-active' : ''}`}>
                        <i /> {selectedTrack.enabled ? 'Ativa' : 'Desativada'}
                      </span>
                    </div>
                  </section>

                  <section className="admin-tracks-v4__info">
                    <strong>Informações</strong>
                    <dl>
                      <div><dt><Music2 /> Artista</dt><dd>{selectedTrack.artist}</dd></div>
                      <div><dt><Disc3 /> Álbum</dt><dd>{selectedTrack.album}</dd></div>
                      <div><dt><Clock3 /> Duração</dt><dd>{formatDuration(selectedTrack.duration)}</dd></div>
                      <div><dt><FileAudio2 /> Formato</dt><dd>{selectedTrack.format || 'Indisponível'}</dd></div>
                      <div><dt><Folder /> Pasta</dt><dd>{selectedTrack.folder || 'Sem pasta'}</dd></div>
                    </dl>
                  </section>

                  <section className="admin-tracks-v4__location">
                    <strong>Localização do arquivo</strong>
                    <div>
                      <FolderOpen />
                      {locationLoading
                        ? <span>Carregando caminho…</span>
                        : locationError
                          ? <span className="is-error">{locationError}</span>
                          : <code>{selectedLocation?.relativePath || 'Indisponível'}</code>}
                      {selectedLocation?.relativePath && (
                        <button
                          type="button"
                          aria-label="Copiar caminho"
                          onClick={() => void navigator.clipboard?.writeText(selectedLocation.relativePath)}
                        ><Copy /></button>
                      )}
                    </div>
                  </section>

                  <aside className="admin-tracks-v4__availability-note">
                    <Info />
                    <div>
                      <strong>Sobre a desativação</strong>
                      <span>Desativar oculta esta faixa da biblioteca e impede a reprodução, mas o arquivo permanece no disco e ela continua vinculada a favoritos e playlists.</span>
                    </div>
                  </aside>

                  <section className="admin-tracks-v4__actions">
                    <strong>Ações</strong>
                    <div>
                      <button type="button" disabled={operationBusy} onClick={() => void toggleTrack(selectedTrack)}>
                        {busyTrackId === selectedTrack.id ? <LoaderCircle className="is-spinning" /> : selectedTrack.enabled ? <CircleOff /> : <Music2 />}
                        {selectedTrack.enabled ? 'Desativar' : 'Reativar'}
                      </button>
                      <button type="button" disabled={operationBusy} onClick={() => organizeTrack(selectedTrack)}>
                        <Folder /> Organizar arquivo
                      </button>
                    </div>
                  </section>

                  <section className="admin-tracks-v4__danger">
                    <strong><Trash2 /> Zona de risco</strong>
                    <button type="button" disabled={operationBusy} onClick={() => void moveToTrash(selectedTrack)}>
                      <Trash2 /> Mover para a Lixeira
                    </button>
                    <small>A faixa será enviada para a lixeira e poderá ser restaurada depois.</small>
                  </section>
                </>
              )}
            </aside>
          </div>
        )}
      </div>

      {selection.selectedItems.length > 0 && (
        <div className="admin-tracks-floating-bulk admin-tracks-floating-bulk--v4">
          <AdminBulkToolbar
            selectedCount={selection.selectedItems.length}
            allVisibleSelected={selection.allVisibleSelected}
            mixedVisibleSelection={selection.mixedVisibleSelection}
            busy={operationBusy}
            completed={batchProgress.completed}
            total={batchProgress.total}
            onToggleVisible={selection.toggleVisible}
            onClear={selection.clear}
          >
            <button
              type="button"
              disabled={operationBusy || selectedInactiveTracks.length === 0}
              onClick={() => void setSelectedEnabled(true)}
            >
              <Music2 /> Reativar {selectedInactiveTracks.length}
            </button>
            <button
              type="button"
              disabled={operationBusy || selectedActiveTracks.length === 0}
              onClick={() => void setSelectedEnabled(false)}
            >
              <CircleOff /> Desativar {selectedActiveTracks.length}
            </button>
            <button
              className="is-danger"
              type="button"
              disabled={operationBusy}
              onClick={() => void quarantineSelected()}
            >
              <Trash2 /> Mover para a Lixeira {selection.selectedItems.length}
            </button>
          </AdminBulkToolbar>
        </div>
      )}

      {movingTrack && (
        <AdminTrackMoveDialog
          track={movingTrack}
          onClose={() => setMovingTrack(null)}
          onMoved={commitMove}
        />
      )}
    </section>
  );
}
