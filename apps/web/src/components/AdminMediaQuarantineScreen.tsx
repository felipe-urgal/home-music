import { useEffect, useMemo, useRef, useState } from 'react';
import type { AdminQuarantinedTrack } from '@home-music/shared';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X
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
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchFeedback, setBatchFeedback] = useState<BatchFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const selectVisibleRef = useRef<HTMLInputElement>(null);

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return tracks;
    return tracks.filter(track => [track.title, track.artist, track.album, track.originalPath]
      .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized)));
  }, [query, tracks]);

  const selectedTrack = tracks.find(track => track.id === selectedTrackId) ?? null;
  const selection = useAdminBulkSelection(tracks, filteredTracks);
  const operationBusy = batchBusy || busyTrackId !== null;

  useEffect(() => {
    if (selectVisibleRef.current) selectVisibleRef.current.indeterminate = selection.mixedVisibleSelection;
  }, [selection.mixedVisibleSelection]);

  useEffect(() => {
    if (selectedTrackId && !tracks.some(track => track.id === selectedTrackId)) setSelectedTrackId(null);
  }, [selectedTrackId, tracks]);

  async function loadTracks(background = false) {
    if (background) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const response = await listAdminQuarantine();
      setTracks(response.tracks);
    } catch (caught) {
      setError(errorMessage(caught));
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
      if (selectedTrackId === track.id) setSelectedTrackId(null);
    } catch (caught) {
      setError(errorMessage(caught));
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
      if (selectedTrackId === track.id) setSelectedTrackId(null);
    } catch (caught) {
      setError(errorMessage(caught));
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
        } catch (caught) {
          refreshError = errorMessage(caught);
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
    <section className="my-account-screen admin-quarantine-screen admin-quarantine-screen--v1" aria-labelledby="admin-quarantine-title">
      <header className="my-account-header admin-quarantine-v1__header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-quarantine-title">Lixeira</strong>
          <small>Restaure antes da exclusão permanente</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <section className="admin-quarantine-v1__notice" aria-label="Proteção da lixeira">
        <span className="admin-quarantine-v1__notice-icon"><Trash2 /></span>
        <div>
          <strong>Arquivos na lixeira não são reproduzidos nem indexados.</strong>
          <small>Restaurar é reversível. Excluir permanentemente apaga o arquivo físico.</small>
        </div>
      </section>

      <section className="admin-quarantine-v1__toolbar" aria-label="Buscar na lixeira">
        <label className="admin-tracks-search admin-quarantine-v1__search">
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
          className="admin-tracks-refresh admin-quarantine-v1__refresh"
          type="button"
          aria-label="Atualizar lixeira"
          disabled={loading || refreshing || operationBusy}
          onClick={() => void loadTracks(true)}
        >
          <RefreshCw className={refreshing ? 'is-spinning' : ''} />
        </button>
      </section>

      {error && <div className="admin-tracks-message is-error admin-quarantine-v1__message" role="alert">{error}</div>}
      {batchFeedback && (
        <div className={`admin-tracks-message admin-quarantine-v1__message ${batchFeedback.error ? 'is-error' : 'is-success'}`} role={batchFeedback.error ? 'alert' : 'status'}>
          {batchFeedback.message}
        </div>
      )}

      {loading ? (
        <div className="admin-tracks-state admin-quarantine-v1__state" role="status"><LoaderCircle className="is-spinning" /> Carregando lixeira…</div>
      ) : filteredTracks.length === 0 ? (
        <div className="admin-tracks-state admin-quarantine-v1__state"><Trash2 /> {tracks.length === 0 ? 'A lixeira está vazia.' : 'Nenhuma música encontrada.'}</div>
      ) : (
        <div className={`admin-quarantine-v1__workspace${selectedTrack ? ' has-inspector' : ''}`}>
          <section className="admin-quarantine-v1__list" aria-label="Músicas na lixeira">
            <header className="admin-quarantine-v1__list-header">
              <label className="admin-quarantine-v1__select-visible">
                <input
                  ref={selectVisibleRef}
                  type="checkbox"
                  checked={selection.allVisibleSelected}
                  disabled={operationBusy}
                  aria-label="Selecionar todas as músicas visíveis"
                  onChange={selection.toggleVisible}
                />
                <span>{filteredTracks.length.toLocaleString('pt-BR')} {filteredTracks.length === 1 ? 'música' : 'músicas'} na lixeira</span>
              </label>
              <small>Selecione uma faixa para ações em lote ou abra os detalhes.</small>
            </header>

            {selection.selectedItems.length > 0 && (
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
                <button type="button" disabled={operationBusy} onClick={() => void restoreSelected()}>
                  <RotateCcw /> Restaurar {selection.selectedItems.length}
                </button>
                <button className="is-danger" type="button" disabled={operationBusy} onClick={() => void deleteSelected()}>
                  <Trash2 /> Excluir {selection.selectedItems.length}
                </button>
              </AdminBulkToolbar>
            )}

            <div className="admin-quarantine-v1__rows">
              {filteredTracks.map(track => {
                const isSelected = selection.selectedIds.has(track.id);
                const isInspected = selectedTrackId === track.id;
                return (
                  <article className={`admin-quarantine-v1__row${isSelected ? ' is-selected' : ''}${isInspected ? ' is-inspected' : ''}`} key={track.id}>
                    <input
                      className="admin-quarantine-v1__row-select"
                      type="checkbox"
                      checked={isSelected}
                      disabled={operationBusy}
                      aria-label={`Selecionar ${track.title}`}
                      onChange={() => selection.toggle(track.id)}
                    />
                    <span className="admin-quarantine-v1__row-icon"><Trash2 /></span>
                    <div className="admin-quarantine-v1__row-main">
                      <strong>{track.title}</strong>
                      <span>{track.artist} · {track.album}</span>
                      <small>{track.originalPath}</small>
                    </div>
                    <div className="admin-quarantine-v1__row-date">
                      <small>Movida em</small>
                      <span>{formatDate(track.quarantinedAt)}</span>
                    </div>
                    <button
                      className="admin-quarantine-v1__inspect"
                      type="button"
                      aria-label={`Ver detalhes de ${track.title}`}
                      aria-pressed={isInspected}
                      onClick={() => setSelectedTrackId(track.id)}
                    >
                      <ChevronRight />
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          {selectedTrack && (
            <aside className="admin-quarantine-v1__inspector" aria-label={`Detalhes de ${selectedTrack.title}`}>
              <header className="admin-quarantine-v1__inspector-header">
                <div>
                  <strong>Detalhes do item</strong>
                  <small>Arquivo na lixeira</small>
                </div>
                <button type="button" aria-label="Fechar detalhes" onClick={() => setSelectedTrackId(null)}><X /></button>
              </header>

              <section className="admin-quarantine-v1__identity">
                <span className="admin-quarantine-v1__identity-icon"><Trash2 /></span>
                <div>
                  <strong>{selectedTrack.title}</strong>
                  <span>{selectedTrack.artist}</span>
                  <small>{selectedTrack.album}</small>
                </div>
              </section>

              <dl className="admin-quarantine-v1__facts">
                <div>
                  <dt><FolderOpen /> Caminho original</dt>
                  <dd>{selectedTrack.originalPath}</dd>
                </div>
                <div>
                  <dt><CalendarDays /> Movida para a lixeira</dt>
                  <dd>{formatDate(selectedTrack.quarantinedAt)}</dd>
                </div>
              </dl>

              {selectedTrack.lastError && (
                <div className="admin-quarantine-v1__last-error" role="status">
                  <AlertTriangle />
                  <div><strong>Última falha registrada</strong><span>{selectedTrack.lastError}</span></div>
                </div>
              )}

              <section className="admin-quarantine-v1__restore-zone">
                <div>
                  <strong>Restaurar para a biblioteca</strong>
                  <small>Recupere o arquivo antes de considerar a exclusão definitiva.</small>
                </div>
                <button
                  type="button"
                  disabled={operationBusy}
                  onClick={() => void restoreTrack(selectedTrack)}
                >
                  {busyTrackId === selectedTrack.id ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                  Restaurar
                </button>
              </section>

              <section className="admin-quarantine-v1__danger-zone">
                <div>
                  <strong>Excluir permanentemente</strong>
                  <small>Apaga o arquivo físico e não pode ser desfeito.</small>
                </div>
                <button
                  type="button"
                  disabled={operationBusy}
                  onClick={() => void deleteTrack(selectedTrack)}
                >
                  <Trash2 /> Excluir permanentemente
                </button>
              </section>
            </aside>
          )}
        </div>
      )}
    </section>
  );
}
