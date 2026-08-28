import { useEffect, useMemo, useState } from 'react';
import type {
  AdminTrack,
  AdminTrackMetadataResponse,
  EditableTrackMetadata
} from '@home-music/shared';
import {
  ChevronLeft,
  ChevronRight,
  Database,
  LoaderCircle,
  Music2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  X
} from 'lucide-react';
import { buildTrackMetadataOverridePatch } from '../admin-track-metadata';
import {
  getAdminTrackMetadata,
  listAdminTracks,
  resetAdminTrackMetadata,
  updateAdminTrackMetadata
} from '../admin-tracks-client';
import { notifyLibraryChanged } from '../library-events';

type AdminTrackMetadataScreenProps = {
  onBack: () => void;
};

const PAGE_SIZE = 50;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function applyEffectiveMetadata(track: AdminTrack, metadata: AdminTrackMetadataResponse): AdminTrack {
  if (track.id !== metadata.trackId) return track;
  return { ...track, ...metadata.effective };
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
  const [draft, setDraft] = useState<EditableTrackMetadata | null>(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

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
    if (saving) return;
    setEditingTrackId(track.id);
    setMetadata(null);
    setDraft(null);
    setEditorLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const loaded = await getAdminTrackMetadata(track.id);
      setMetadata(loaded);
      setDraft(loaded.effective);
    } catch (error) {
      setError(errorMessage(error));
      setEditingTrackId(null);
    } finally {
      setEditorLoading(false);
    }
  }

  function closeEditor() {
    if (saving) return;
    setEditingTrackId(null);
    setMetadata(null);
    setDraft(null);
  }

  function setField(field: keyof EditableTrackMetadata, value: string) {
    setDraft(current => current ? { ...current, [field]: value } : current);
  }

  function commitMetadata(updated: AdminTrackMetadataResponse, message: string) {
    setMetadata(updated);
    setDraft(updated.effective);
    setTracks(items => items.map(track => applyEffectiveMetadata(track, updated)));
    setFeedback(message);
    notifyLibraryChanged();
  }

  async function saveMetadata() {
    if (!metadata || !draft || saving) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const patch = buildTrackMetadataOverridePatch(metadata.physical, draft);
      const updated = await updateAdminTrackMetadata(metadata.trackId, patch);
      commitMetadata(updated, 'Metadados salvos como override. O arquivo original não foi alterado.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function resetMetadata() {
    if (!metadata || saving || !hasOverride(metadata)) return;
    if (!window.confirm('Restaurar os metadados exibidos para os valores do arquivo original?\n\nO arquivo físico não será modificado.')) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const updated = await resetAdminTrackMetadata(metadata.trackId);
      commitMetadata(updated, 'Overrides removidos. A biblioteca voltou a exibir os metadados do arquivo.');
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="my-account-screen admin-metadata-screen" aria-labelledby="admin-metadata-title">
      <header className="my-account-header">
        <button className="icon-button" type="button" aria-label="Voltar" onClick={onBack}><ChevronLeft /></button>
        <div>
          <strong id="admin-metadata-title">Metadados</strong>
          <small>Correções não destrutivas sobre a metadata do arquivo</small>
        </div>
        <span className="my-account-header__spacer" />
      </header>

      <div className="admin-metadata-overview">
        <div className="admin-metadata-notice" role="note">
          <Database />
          <div>
            <strong>O arquivo original permanece intacto</strong>
            <small>As correções ficam no SQLite e continuam valendo depois de novos scans.</small>
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
            disabled={loading || refreshing || saving}
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
                  disabled={saving || editorLoading}
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
                  <button type="button" aria-label="Página anterior" disabled={page <= 1 || saving} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
                  <button type="button" aria-label="Próxima página" disabled={page >= pageCount || saving} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
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
                <small>Somente a camada de override será salva.</small>
              </div>
              <button type="button" aria-label="Fechar edição de metadados" disabled={saving} onClick={closeEditor}><X /></button>
            </header>

            {editorLoading || !metadata || !draft ? (
              <div className="admin-metadata-dialog__loading" role="status"><LoaderCircle className="is-spinning" /> Carregando metadados…</div>
            ) : (
              <form onSubmit={event => { event.preventDefault(); void saveMetadata(); }}>
                <div className="admin-metadata-fields">
                  <label>
                    <span>Título</span>
                    <input required maxLength={240} value={draft.title} disabled={saving} onChange={event => setField('title', event.target.value)} />
                    <small>Arquivo: {metadata.physical.title}</small>
                  </label>
                  <label>
                    <span>Artista</span>
                    <input required maxLength={240} value={draft.artist} disabled={saving} onChange={event => setField('artist', event.target.value)} />
                    <small>Arquivo: {metadata.physical.artist}</small>
                  </label>
                  <label>
                    <span>Álbum</span>
                    <input required maxLength={240} value={draft.album} disabled={saving} onChange={event => setField('album', event.target.value)} />
                    <small>Arquivo: {metadata.physical.album}</small>
                  </label>
                  <label>
                    <span>Artista do álbum</span>
                    <input required maxLength={240} value={draft.albumArtist} disabled={saving} onChange={event => setField('albumArtist', event.target.value)} />
                    <small>Arquivo: {metadata.physical.albumArtist}</small>
                  </label>
                </div>

                <footer className="admin-metadata-dialog__actions">
                  <button
                    className="admin-metadata-reset"
                    type="button"
                    disabled={saving || !hasOverride(metadata)}
                    onClick={() => void resetMetadata()}
                  >
                    <RotateCcw /> Restaurar arquivo
                  </button>
                  <button className="admin-metadata-save" type="submit" disabled={saving}>
                    {saving ? <LoaderCircle className="is-spinning" /> : <Save />}
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
