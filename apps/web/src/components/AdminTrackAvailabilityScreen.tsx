import { useEffect, useMemo, useState } from 'react';
import type { AdminTrack } from '@home-music/shared';
import {
  ChevronLeft,
  ChevronRight,
  CircleOff,
  LoaderCircle,
  Music2,
  RefreshCw,
  Search,
  Trash2
} from 'lucide-react';
import { quarantineAdminTrack } from '../admin-quarantine-client';
import { listAdminTracks, setAdminTrackEnabled } from '../admin-tracks-client';

type AdminTrackAvailabilityScreenProps = {
  onBack: () => void;
};

type AvailabilityFilter = 'all' | 'active' | 'inactive';

const PAGE_SIZE = 50;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export function AdminTrackAvailabilityScreen({ onBack }: AdminTrackAvailabilityScreenProps) {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTrackId, setBusyTrackId] = useState<string | null>(null);
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
  const visibleTracks = filteredTracks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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

  useEffect(() => { void loadTracks(); }, []);

  async function toggleTrack(track: AdminTrack) {
    if (busyTrackId) return;
    setBusyTrackId(track.id);
    setError(null);
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
    if (busyTrackId) return;
    if (!window.confirm(`Mover “${track.title}” para a lixeira?\n\nO arquivo poderá ser restaurado depois.`)) return;

    setBusyTrackId(track.id);
    setError(null);
    try {
      await quarantineAdminTrack(track.id);
      setTracks(items => items.filter(item => item.id !== track.id));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusyTrackId(null);
    }
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
            disabled={loading || refreshing}
            onClick={() => void loadTracks(true)}
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} />
          </button>
        </section>

        {error && <div className="admin-tracks-message is-error" role="alert">{error}</div>}

        {loading ? (
          <div className="admin-tracks-state" role="status"><LoaderCircle className="is-spinning" /> Carregando músicas…</div>
        ) : filteredTracks.length === 0 ? (
          <div className="admin-tracks-state"><Music2 /> Nenhuma música encontrada com estes filtros.</div>
        ) : (
          <section className="admin-tracks-list" aria-label="Músicas administráveis">
            <div className="admin-tracks-list__count">
              {filteredTracks.length.toLocaleString('pt-BR')} {filteredTracks.length === 1 ? 'música' : 'músicas'}
            </div>
            {visibleTracks.map(track => (
              <article className={`admin-track-row ${track.enabled ? '' : 'is-disabled'}`} key={track.id}>
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
                    disabled={busyTrackId !== null}
                    onClick={() => void toggleTrack(track)}
                  >
                    {busyTrackId === track.id ? <LoaderCircle className="is-spinning" /> : null}
                    {track.enabled ? 'Desativar' : 'Reativar'}
                  </button>
                  <button
                    className="admin-track-row__trash"
                    type="button"
                    disabled={busyTrackId !== null}
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
                  <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft /></button>
                  <button type="button" aria-label="Próxima página" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}><ChevronRight /></button>
                </div>
              </footer>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
