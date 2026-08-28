import { useEffect, useMemo, useState } from 'react';
import type { AdminTrack, Playlist } from '@home-music/shared';
import {
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Heart,
  ListPlus,
  LoaderCircle,
  Music2,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react';
import { runAdminBatch, summarizeAdminBatch } from '../admin-batch';
import {
  favoriteCurrentUserTrack,
  loadCurrentUserFavoriteIds,
  loadCurrentUserManualPlaylists,
  setCurrentUserPlaylistTracks
} from '../admin-personal-library-client';
import { quarantineAdminTrack } from '../admin-quarantine-client';
import { listAdminTracks, setAdminTrackEnabled } from '../admin-tracks-client';
import { useAdminBulkSelection } from '../useAdminBulkSelection';
import { AdminBulkToolbar } from './AdminBulkToolbar';

type AdminTrackAvailabilityScreenProps = {
  onBack: () => void;
};

type AvailabilityFilter = 'all' | 'active' | 'inactive';
type BatchFeedback = { message: string; error: boolean };

const PAGE_SIZE = 50;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export function AdminTrackAvailabilityScreen({ onBack }: AdminTrackAvailabilityScreenProps) {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchFeedback, setBatchFeedback] = useState<BatchFeedback | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string> | null>(null);
  const [manualPlaylists, setManualPlaylists] = useState<Playlist[] | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AvailabilityFilter>('all');
  const [page, setPage] = useState(1);

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
      return [track.title, track.artist, track.album, track.folder]
        .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized));
    });
  }, [filter, query, tracks]);

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / PAGE_SIZE));
  const visibleTracks = useMemo(
    () => filteredTracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredTracks, page]
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
  const favoritableTracks = useMemo(
    () => favoriteIds == null
      ? []
      : selectedActiveTracks.filter(track => !favoriteIds.has(track.id)),
    [favoriteIds, selectedActiveTracks]
  );
  const selectedPlaylist = useMemo(
    () => manualPlaylists?.find(playlist => playlist.id === selectedPlaylistId) ?? null,
    [manualPlaylists, selectedPlaylistId]
  );
  const playlistAddableTracks = useMemo(
    () => selectedPlaylist
      ? selectedActiveTracks.filter(track => !selectedPlaylist.trackIds.includes(track.id))
      : [],
    [selectedActiveTracks, selectedPlaylist]
  );
  const operationBusy = batchBusy || busyTrackId !== null;

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  async function loadTracks(background = false) {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await listAdminTracks();
      setTracks(response.tracks);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }

  async function loadFavorites() {
    try {
      setFavoriteIds(new Set(await loadCurrentUserFavoriteIds()));
    } catch (error) {
      setFavoriteIds(null);
      setError(`Favoritos: ${errorMessage(error)}`);
    }
  }

  async function loadManualPlaylists() {
    try {
      setManualPlaylists(await loadCurrentUserManualPlaylists());
    } catch (error) {
      setManualPlaylists([]);
      setError(`Playlists: ${errorMessage(error)}`);
    }
  }

  useEffect(() => {
    void loadTracks();
    void loadFavorites();
    void loadManualPlaylists();
  }, []);

  async function toggleTrack(track: AdminTrack) {
    if (operationBusy) return;
    setBusyTrackId(track.id);
    setError(null);
    setBatchFeedback(null);
    try {
      const updated = await setAdminTrackEnabled(track.id, !track.enabled);
      setTracks(items => items.map(item => item.id === updated.id ? updated : item));
    } catch (error) {
      setError(errorMessage(error));
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
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyTrackId(null);
    }
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

  async function favoriteSelected() {
    if (favoriteIds == null) {
      setError('Não foi possível carregar os favoritos do usuário atual.');
      return;
    }
    await runTrackBatch(
      'Favoritos',
      favoritableTracks,
      track => favoriteCurrentUserTrack(track.id),
      succeeded => setFavoriteIds(current => {
        const next = new Set(current ?? []);
        succeeded.forEach(track => next.add(track.id));
        return next;
      })
    );
  }

  async function addSelectedToPlaylist() {
    if (operationBusy || !selectedPlaylist || playlistAddableTracks.length === 0) return;
    setBatchBusy(true);
    setBatchProgress({ completed: 0, total: 1 });
    setBatchFeedback(null);
    setError(null);
    try {
      const nextTrackIds = [
        ...selectedPlaylist.trackIds,
        ...playlistAddableTracks.map(track => track.id)
      ];
      await setCurrentUserPlaylistTracks(selectedPlaylist, nextTrackIds);
      setManualPlaylists(items => (items ?? []).map(playlist => (
        playlist.id === selectedPlaylist.id ? { ...playlist, trackIds: nextTrackIds } : playlist
      )));
      setBatchProgress({ completed: 1, total: 1 });
      selection.clear();
      setBatchFeedback({
        message: `Playlist: ${playlistAddableTracks.length} ${playlistAddableTracks.length === 1 ? 'faixa adicionada' : 'faixas adicionadas'} a “${selectedPlaylist.name}”.`,
        error: false
      });
    } catch (error) {
      setBatchFeedback({ message: `Playlist: ${errorMessage(error)}`, error: true });
    } finally {
      setBatchBusy(false);
    }
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
      }
    );
  }

  return (
    <section className="my-account-screen admin-tracks-screen" aria-labelledby="admin-tracks-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-tracks-title">Gerenciar músicas</strong>
          <small>Disponibilidade e remoção reversível</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-tracks-overview">
        <section className="admin-tracks-summary" aria-label="Resumo de disponibilidade">
          <article>
            <span className="admin-tracks-summary__icon is-active"><Music2 /></span>
            <div><small>Ativas</small><strong>{counts.active.toLocaleString('pt-BR')}</strong></div>
          </article>
          <article>
            <span className="admin-tracks-summary__icon"><CircleOff /></span>
            <div><small>Desativadas</small><strong>{counts.inactive.toLocaleString('pt-BR')}</strong></div>
          </article>
        </section>

        <section className="admin-tracks-toolbar" aria-label="Filtros de músicas">
          <label className="admin-tracks-search">
            <Search />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar título, artista, álbum ou pasta"
              aria-label="Buscar músicas"
            />
          </label>
          <div className="admin-tracks-filters" role="group" aria-label="Filtrar disponibilidade">
            <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>Todas</button>
            <button type="button" className={filter === 'active' ? 'is-active' : ''} onClick={() => setFilter('active')}>Ativas</button>
            <button type="button" className={filter === 'inactive' ? 'is-active' : ''} onClick={() => setFilter('inactive')}>Desativadas</button>
          </div>
          <button
            className="admin-tracks-refresh"
            type="button"
            aria-label="Atualizar músicas"
            disabled={loading || refreshing || operationBusy}
            onClick={() => void loadTracks(true)}
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} />
          </button>
        </section>

        {error && <div className="admin-tracks-message is-error" role="alert">{error}</div>}
        {batchFeedback && (
          <div className={`admin-tracks-message ${batchFeedback.error ? 'is-error' : 'is-success'}`} role={batchFeedback.error ? 'alert' : 'status'}>
            {batchFeedback.message}
          </div>
        )}

        {loading ? (
          <div className="admin-tracks-state" role="status"><LoaderCircle className="is-spinning" /> Carregando músicas…</div>
        ) : filteredTracks.length === 0 ? (
          <div className="admin-tracks-state"><Music2 /> Nenhuma música encontrada com estes filtros.</div>
        ) : (
          <section className="admin-tracks-list" aria-label="Músicas administráveis">
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
                type="button"
                disabled={operationBusy || favoriteIds == null || favoritableTracks.length === 0}
                onClick={() => void favoriteSelected()}
              >
                <Heart /> {favoritableTracks.length > 0 ? `Favoritar ${favoritableTracks.length}` : 'Favoritas'}
              </button>
              <div className="admin-bulk-toolbar__playlist">
                <select
                  value={selectedPlaylistId}
                  disabled={operationBusy || manualPlaylists == null || manualPlaylists.length === 0}
                  aria-label="Playlist para seleção"
                  onChange={event => setSelectedPlaylistId(event.target.value)}
                >
                  <option value="">
                    {manualPlaylists == null
                      ? 'Carregando playlists…'
                      : manualPlaylists.length === 0
                        ? 'Nenhuma playlist manual'
                        : 'Playlist…'}
                  </option>
                  {(manualPlaylists ?? []).map(playlist => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
                </select>
                <button
                  type="button"
                  disabled={operationBusy || !selectedPlaylist || playlistAddableTracks.length === 0}
                  onClick={() => void addSelectedToPlaylist()}
                >
                  <ListPlus /> Adicionar {playlistAddableTracks.length || ''}
                </button>
              </div>
              <button
                className="is-danger"
                type="button"
                disabled={operationBusy}
                onClick={() => void quarantineSelected()}
              >
                <Trash2 /> Lixeira {selection.selectedItems.length}
              </button>
            </AdminBulkToolbar>

            <div className="admin-tracks-list__count">
              {filteredTracks.length.toLocaleString('pt-BR')} {filteredTracks.length === 1 ? 'música' : 'músicas'}
            </div>
            {visibleTracks.map(track => (
              <article className={`admin-track-row ${track.enabled ? '' : 'is-disabled'} ${selection.selectedIds.has(track.id) ? 'is-selected' : ''}`.trim()} key={track.id}>
                <input
                  className="admin-track-row__select"
                  type="checkbox"
                  checked={selection.selectedIds.has(track.id)}
                  disabled={operationBusy}
                  aria-label={`Selecionar ${track.title}`}
                  onChange={() => selection.toggle(track.id)}
                />
                <span className={`admin-track-row__icon ${track.enabled ? 'is-active' : ''}`}>
                  {track.enabled ? <Music2 /> : <CircleOff />}
                </span>
                <div className="admin-track-row__body">
                  <strong>{track.title}</strong>
                  <small>{track.artist} · {track.album}</small>
                  <small className="admin-track-row__folder">{track.folder}</small>
                </div>
                <span className={`admin-track-row__status ${track.enabled ? 'is-active' : ''}`}>
                  {track.enabled ? 'Ativa' : 'Desativada'}
                </span>
                <div className="admin-track-row__actions">
                  <button
                    className={`admin-track-row__action ${track.enabled ? 'is-disable' : 'is-enable'}`}
                    type="button"
                    disabled={operationBusy}
                    onClick={() => void toggleTrack(track)}
                  >
                    {busyTrackId === track.id ? <LoaderCircle className="is-spinning" /> : null}
                    {track.enabled ? 'Desativar' : 'Reativar'}
                  </button>
                  <button
                    className="admin-track-row__trash"
                    type="button"
                    disabled={operationBusy}
                    onClick={() => void moveToTrash(track)}
                  >
                    <Trash2 /> Mover para lixeira
                  </button>
                </div>
              </article>
            ))}
            {pageCount > 1 && (
              <footer className="admin-tracks-pagination">
                <span>Página {page} de {pageCount}</span>
                <div>
                  <button type="button" aria-label="Página anterior" disabled={page <= 1 || operationBusy} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
                  <button type="button" aria-label="Próxima página" disabled={page >= pageCount || operationBusy} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
                </div>
              </footer>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
