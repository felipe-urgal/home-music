import { useEffect, useMemo, useState } from 'react';
import type { AdminQuarantinedTrack } from '@home-music/shared';
import {
  ChevronLeft,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import { runAdminBatch, summarizeAdminBatch } from '../admin-batch';
import {
  deleteAdminQuarantinedTrack,
  listAdminQuarantine,
  refreshLibraryAfterPermanentDelete,
  restoreAdminQuarantinedTrack
} from '../admin-quarantine-client';
import { useAdminBulkSelection } from '../useAdminBulkSelection';
import { AdminBulkToolbar } from './AdminBulkToolbar';

type AdminMediaQuarantineScreenProps = {
  onBack: () => void;
};

type BatchFeedback = { message: string; error: boolean };

const BULK_DELETE_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function formatDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

export function AdminMediaQuarantineScreen({ onBack }: AdminMediaQuarantineScreenProps) {
  const [tracks, setTracks] = useState<AdminQuarantinedTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchFeedback, setBatchFeedback] = useState<BatchFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return tracks;
    return tracks.filter(track => [track.title, track.artist, track.album, track.originalPath]
      .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized)));
  }, [query, tracks]);
  const selection = useAdminBulkSelection(tracks, filteredTracks);
  const operationBusy = batchBusy || busyTrackId !== null;

  async function loadTracks(background = false) {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await listAdminQuarantine();
      setTracks(response.tracks);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (background) setRefreshing(false); else setLoading(false);
    }
  }

  useEffect(() => { void loadTracks(); }, []);

  async function restoreTrack(track: AdminQuarantinedTrack) {
    if (operationBusy) return;
    setBusyTrackId(track.id);
    setError(null);
    setBatchFeedback(null);
    try {
      await restoreAdminQuarantinedTrack(track.id);
      setTracks(items => items.filter(item => item.id !== track.id));
    } catch (error) {
      setError(errorMessage(error));
      void loadTracks(true);
    } finally {
      setBusyTrackId(null);
    }
  }

  async function deleteTrack(track: AdminQuarantinedTrack) {
    if (operationBusy) return;
    const confirmed = window.confirm(
      `Excluir “${track.title}” permanentemente?\n\nO arquivo físico será apagado e esta ação não poderá ser desfeita.`
    );
    if (!confirmed) return;

    setBusyTrackId(track.id);
    setError(null);
    setBatchFeedback(null);
    try {
      await deleteAdminQuarantinedTrack(track.id);
      setTracks(items => items.filter(item => item.id !== track.id));
    } catch (error) {
      setError(errorMessage(error));
      void loadTracks(true);
    } finally {
      setBusyTrackId(null);
    }
  }

  async function restoreSelected() {
    if (operationBusy || selection.selectedItems.length === 0) return;
    const selected = selection.selectedItems;
    setBatchBusy(true);
    setBatchProgress({ completed: 0, total: selected.length });
    setBatchFeedback(null);
    setError(null);
    try {
      const result = await runAdminBatch(selected, track => restoreAdminQuarantinedTrack(track.id), {
        concurrency: 4,
        onProgress: (completed, total) => setBatchProgress({ completed, total })
      });
      const succeededIds = new Set(result.succeeded.map(track => track.id));
      setTracks(items => items.filter(item => !succeededIds.has(item.id)));
      selection.retain(result.failed.map(failure => failure.item.id));
      setBatchFeedback({
        message: summarizeAdminBatch('Restauração', result),
        error: result.failed.length > 0
      });
    } finally {
      setBatchBusy(false);
    }
  }

  async function deleteSelected() {
    if (operationBusy || selection.selectedItems.length === 0) return;
    const selected = selection.selectedItems;
    const typed = window.prompt(
      `Excluir permanentemente ${selected.length} ${selected.length === 1 ? 'música' : 'músicas'}?\n\nOs arquivos físicos serão apagados sem possibilidade de restauração.\n\nDigite ${BULK_DELETE_CONFIRMATION} para confirmar.`
    );
    if (typed?.trim() !== BULK_DELETE_CONFIRMATION) return;

    setBatchBusy(true);
    setBatchProgress({ completed: 0, total: selected.length });
    setBatchFeedback(null);
    setError(null);
    try {
      const result = await runAdminBatch(
        selected,
        track => deleteAdminQuarantinedTrack(track.id, { refreshLibrary: false }),
        {
          concurrency: 3,
          onProgress: (completed, total) => setBatchProgress({ completed, total })
        }
      );

      const succeededIds = new Set(result.succeeded.map(track => track.id));
      setTracks(items => items.filter(item => !succeededIds.has(item.id)));
      selection.retain(result.failed.map(failure => failure.item.id));

      let refreshError: string | null = null;
      if (result.succeeded.length > 0) {
        try {
          await refreshLibraryAfterPermanentDelete();
        } catch (error) {
          refreshError = errorMessage(error);
        }
      }

      const summary = summarizeAdminBatch('Exclusão permanente', result);
      setBatchFeedback({
        message: refreshError ? `${summary} ${refreshError}` : summary,
        error: result.failed.length > 0 || Boolean(refreshError)
      });
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <section className="my-account-screen admin-quarantine-screen" aria-labelledby="admin-quarantine-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-quarantine-title">Lixeira</strong>
          <small>Restaure antes da exclusão permanente</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-quarantine-overview">
        <section className="admin-quarantine-notice" aria-label="Proteção da lixeira">
          <Trash2 />
          <div>
            <strong>Arquivos na lixeira não são reproduzidos nem indexados.</strong>
            <small>Restaurar é reversível. Excluir permanentemente apaga o arquivo físico.</small>
          </div>
        </section>

        <section className="admin-quarantine-toolbar" aria-label="Buscar na lixeira">
          <label className="admin-tracks-search">
            <Search />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar título, artista, álbum ou caminho"
              aria-label="Buscar na lixeira"
            />
          </label>
          <button
            className="admin-tracks-refresh"
            type="button"
            aria-label="Atualizar lixeira"
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
          <div className="admin-tracks-state" role="status"><LoaderCircle className="is-spinning" /> Carregando lixeira…</div>
        ) : filteredTracks.length === 0 ? (
          <div className="admin-tracks-state"><Trash2 /> {tracks.length === 0 ? 'A lixeira está vazia.' : 'Nenhuma música encontrada.'}</div>
        ) : (
          <section className="admin-quarantine-list" aria-label="Músicas na lixeira">
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
                disabled={operationBusy}
                onClick={() => void restoreSelected()}
              >
                <RotateCcw /> Restaurar {selection.selectedItems.length}
              </button>
              <button
                className="is-danger"
                type="button"
                disabled={operationBusy}
                onClick={() => void deleteSelected()}
              >
                <Trash2 /> Excluir {selection.selectedItems.length}
              </button>
            </AdminBulkToolbar>

            <div className="admin-tracks-list__count">
              {filteredTracks.length.toLocaleString('pt-BR')} {filteredTracks.length === 1 ? 'música' : 'músicas'} na lixeira
            </div>
            {filteredTracks.map(track => (
              <article className={`admin-quarantine-row ${selection.selectedIds.has(track.id) ? 'is-selected' : ''}`.trim()} key={track.id}>
                <input
                  className="admin-quarantine-row__select"
                  type="checkbox"
                  checked={selection.selectedIds.has(track.id)}
                  disabled={operationBusy}
                  aria-label={`Selecionar ${track.title}`}
                  onChange={() => selection.toggle(track.id)}
                />
                <span className="admin-quarantine-row__icon"><Trash2 /></span>
                <div className="admin-quarantine-row__body">
                  <strong>{track.title}</strong>
                  <small>{track.artist} · {track.album}</small>
                  <small className="admin-quarantine-row__path">{track.originalPath}</small>
                  <small>Movida em {formatDate(track.quarantinedAt)}</small>
                  {track.lastError && <small className="admin-quarantine-row__error">Última falha: {track.lastError}</small>}
                </div>
                <div className="admin-quarantine-row__actions">
                  <button
                    className="admin-quarantine-restore"
                    type="button"
                    disabled={operationBusy}
                    onClick={() => void restoreTrack(track)}
                  >
                    {busyTrackId === track.id ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                    Restaurar
                  </button>
                  <button
                    className="admin-quarantine-delete"
                    type="button"
                    disabled={operationBusy}
                    onClick={() => void deleteTrack(track)}
                  >
                    <Trash2 /> Excluir permanentemente
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}
