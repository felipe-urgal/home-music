import { useEffect, useMemo, useState } from 'react';
import type {
  AdminTrack,
  AdminTrackCoverResponse,
  AdminTrackMetadataResponse,
  EditableTrackMetadata
} from '@home-music/shared';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  ImagePlus,
  LoaderCircle,
  Music2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Upload,
  X
} from 'lucide-react';
import { adminCoverUrl, validateAdminCoverFile } from '../admin-track-cover';
import { buildTrackMetadataOverridePatch } from '../admin-track-metadata';
import {
  getAdminTrackCover,
  getAdminTrackMetadata,
  listAdminTracks,
  resetAdminTrackCover,
  resetAdminTrackMetadata,
  updateAdminTrackCover,
  updateAdminTrackMetadata
} from '../admin-tracks-client';
import { notifyLibraryChanged } from '../library-events';

type AdminTrackMetadataScreenProps = {
  onBack: () => void;
};

type EditorFeedback = {
  message: string;
  error: boolean;
};

type SavingAction = 'text-save' | 'text-reset' | 'cover-save' | 'cover-reset' | null;

const PAGE_SIZE = 50;

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
  return { ...track, ...metadata.effective };
}

function applyEffectiveCover(track: AdminTrack, cover: AdminTrackCoverResponse): AdminTrack {
  if (track.id !== cover.trackId) return track;
  return {
    ...track,
    hasCover: cover.effectiveHasCover,
    coverVersion: cover.override?.version
  };
}

function hasOverride(metadata: AdminTrackMetadataResponse | null) {
  return Boolean(metadata?.override.updatedAt);
}

export function AdminTrackMetadataScreen({ onBack }: AdminTrackMetadataScreenProps) {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
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
  const operationBusy = savingAction !== null;

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return tracks;
    return tracks.filter(track => [track.title, track.artist, track.album, track.folder]
      .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized)));
  }, [query, tracks]);

  const pageCount = Math.max(1, Math.ceil(filteredTracks.length / PAGE_SIZE));
  const visibleTracks = useMemo(
    () => filteredTracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredTracks, page]
  );

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [query]);

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
      setEditingTrackId(null);
      setMetadata(null);
      setCover(null);
      setCoverFile(null);
      setDraft(null);
      setEditorFeedback(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingTrackId, operationBusy]);

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

  useEffect(() => {
    void loadTracks();
  }, []);

  async function openEditor(track: AdminTrack) {
    if (operationBusy) return;
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
      setMetadata(loadedMetadata);
      setCover(loadedCover);
      setDraft(loadedMetadata.effective);
    } catch (error) {
      setError(errorMessage(error));
      setEditingTrackId(null);
    } finally {
      setEditorLoading(false);
    }
  }

  function closeEditor() {
    if (operationBusy) return;
    setEditingTrackId(null);
    setMetadata(null);
    setCover(null);
    setCoverFile(null);
    setDraft(null);
    setEditorFeedback(null);
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
    } catch (error) {
      setCoverFile(null);
      setEditorFeedback({ message: errorMessage(error), error: true });
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
    } catch (error) {
      setEditorFeedback({ message: errorMessage(error), error: true });
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
    } catch (error) {
      setEditorFeedback({ message: errorMessage(error), error: true });
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
    } catch (error) {
      setEditorFeedback({ message: errorMessage(error), error: true });
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
    } catch (error) {
      setEditorFeedback({ message: errorMessage(error), error: true });
    } finally {
      setSavingAction(null);
    }
  }

  const persistedCoverUrl = editingTrackId && cover ? adminCoverUrl(editingTrackId, cover) : null;
  const displayedCoverUrl = coverPreviewUrl ?? persistedCoverUrl;

  return (
    <section className="my-account-screen admin-metadata-screen" aria-labelledby="admin-metadata-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-metadata-title">Metadados</strong>
          <small>Correções não destrutivas de texto e capa</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-metadata-overview">
        <div className="admin-metadata-notice" role="note">
          <Database />
          <div>
            <strong>O arquivo original permanece intacto</strong>
            <small>Texto e capa ficam como overrides no SQLite e continuam valendo depois de novos scans.</small>
          </div>
        </div>

        <section className="admin-tracks-toolbar" aria-label="Buscar metadados de músicas">
          <label className="admin-tracks-search">
            <Search />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar título, artista, álbum ou pasta"
              aria-label="Buscar músicas para editar metadados"
            />
          </label>
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
        {feedback && <div className="admin-tracks-message is-success" role="status">{feedback}</div>}

        {loading ? (
          <div className="admin-tracks-state" role="status"><LoaderCircle className="is-spinning" /> Carregando músicas…</div>
        ) : filteredTracks.length === 0 ? (
          <div className="admin-tracks-state"><Music2 /> Nenhuma música encontrada.</div>
        ) : (
          <section className="admin-metadata-list" aria-label="Músicas com metadados editáveis">
            <div className="admin-tracks-list__count">
              {filteredTracks.length.toLocaleString('pt-BR')} {filteredTracks.length === 1 ? 'música' : 'músicas'}
            </div>
            {visibleTracks.map(track => (
              <article className="admin-metadata-row" key={track.id}>
                <span className="admin-track-row__icon is-active"><Music2 /></span>
                <div className="admin-track-row__body">
                  <strong>{track.title}</strong>
                  <small>{track.artist} · {track.album}</small>
                  <small className="admin-track-row__folder">{track.folder}</small>
                </div>
                <button
                  className="admin-metadata-row__edit"
                  type="button"
                  disabled={operationBusy || editorLoading}
                  onClick={() => void openEditor(track)}
                >
                  <Pencil /> Editar
                </button>
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

      {editingTrackId && (
        <div className="admin-metadata-dialog-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) closeEditor();
        }}>
          <section
            className="admin-metadata-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-metadata-dialog-title"
          >
            <header className="admin-metadata-dialog__header">
              <div>
                <strong id="admin-metadata-dialog-title">Editar metadados</strong>
                <small>Somente camadas reversíveis serão salvas.</small>
              </div>
              <button type="button" aria-label="Fechar edição de metadados" disabled={operationBusy} onClick={closeEditor}><X /></button>
            </header>

            {editorLoading || !metadata || !draft || !cover ? (
              <div className="admin-metadata-dialog__loading" role="status"><LoaderCircle className="is-spinning" /> Carregando metadados…</div>
            ) : (
              <form onSubmit={event => { event.preventDefault(); void saveMetadata(); }}>
                {editorFeedback && (
                  <div
                    className={`admin-metadata-dialog__message ${editorFeedback.error ? 'is-error' : 'is-success'}`}
                    role={editorFeedback.error ? 'alert' : 'status'}
                  >
                    {editorFeedback.message}
                  </div>
                )}
                <div className="admin-metadata-fields">
                  <label>
                    <span>Título</span>
                    <input autoFocus required maxLength={240} value={draft.title} disabled={operationBusy} onChange={event => setField('title', event.target.value)} />
                    <small>Arquivo: {metadata.physical.title}</small>
                  </label>
                  <label>
                    <span>Artista</span>
                    <input required maxLength={240} value={draft.artist} disabled={operationBusy} onChange={event => setField('artist', event.target.value)} />
                    <small>Arquivo: {metadata.physical.artist}</small>
                  </label>
                  <label>
                    <span>Álbum</span>
                    <input required maxLength={240} value={draft.album} disabled={operationBusy} onChange={event => setField('album', event.target.value)} />
                    <small>Arquivo: {metadata.physical.album}</small>
                  </label>
                  <label>
                    <span>Artista do álbum</span>
                    <input required maxLength={240} value={draft.albumArtist} disabled={operationBusy} onChange={event => setField('albumArtist', event.target.value)} />
                    <small>Arquivo: {metadata.physical.albumArtist}</small>
                  </label>
                </div>

                <section className="admin-cover-editor" aria-labelledby="admin-cover-editor-title">
                  <div className={`admin-cover-editor__preview ${displayedCoverUrl ? '' : 'is-empty'}`}>
                    {displayedCoverUrl ? (
                      <img src={displayedCoverUrl} alt={`Preview da capa de ${draft.title}`} />
                    ) : (
                      <ImagePlus aria-hidden="true" />
                    )}
                  </div>
                  <div className="admin-cover-editor__body">
                    <div className="admin-cover-editor__heading">
                      <div>
                        <strong id="admin-cover-editor-title">Capa</strong>
                        <small>
                          {coverFile
                            ? 'Preview local — a imagem ainda não foi enviada.'
                            : cover.override
                              ? `Override ativo · ${cover.override.width}×${cover.override.height} · ${formatBytes(cover.override.sizeBytes)}`
                              : cover.physicalHasCover
                                ? 'Usando a capa embutida no arquivo de áudio.'
                                : 'O arquivo original não possui capa.'}
                        </small>
                      </div>
                      {cover.override && <span>Override</span>}
                    </div>

                    {coverFile && (
                      <div className="admin-cover-editor__file">
                        <strong>{coverFile.name}</strong>
                        <small>{formatBytes(coverFile.size)} · {coverFile.type}</small>
                      </div>
                    )}

                    <div className="admin-cover-editor__actions">
                      <label className={`admin-cover-upload ${operationBusy ? 'is-disabled' : ''}`}>
                        <Upload /> {coverFile ? 'Trocar seleção' : 'Selecionar imagem'}
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
                      <button
                        className="admin-cover-save"
                        type="button"
                        disabled={operationBusy || !coverFile}
                        onClick={() => void saveCover()}
                      >
                        {savingAction === 'cover-save' ? <LoaderCircle className="is-spinning" /> : <Save />}
                        Salvar capa
                      </button>
                      <button
                        className="admin-cover-reset"
                        type="button"
                        disabled={operationBusy || !cover.override}
                        onClick={() => void resetCover()}
                      >
                        {savingAction === 'cover-reset' ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                        Restaurar capa do arquivo
                      </button>
                    </div>
                  </div>
                </section>

                <footer className="admin-metadata-dialog__actions">
                  <button
                    className="admin-metadata-reset"
                    type="button"
                    disabled={operationBusy || !hasOverride(metadata)}
                    onClick={() => void resetMetadata()}
                  >
                    {savingAction === 'text-reset' ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                    Restaurar arquivo
                  </button>
                  <button className="admin-metadata-save" type="submit" disabled={operationBusy}>
                    {savingAction === 'text-save' ? <LoaderCircle className="is-spinning" /> : <Save />}
                    Salvar override
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
