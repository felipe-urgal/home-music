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
import {
  deleteAdminQuarantinedTrack,
  listAdminQuarantine,
  restoreAdminQuarantinedTrack
} from '../admin-quarantine-client';

type AdminMediaQuarantineScreenProps = {
  onBack: () => void;
};

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
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const filteredTracks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return tracks;
    return tracks.filter(track => [track.title, track.artist, track.album, track.originalPath]
      .some(value => value.toLocaleLowerCase('pt-BR').includes(normalized)));
  }, [query, tracks]);

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
    if (busyTrackId) return;
    setBusyTrackId(track.id);
    setError(null);
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
    if (busyTrackId) return;
    const confirmed = window.confirm(
      `Excluir “${track.title}” permanentemente?\n\nO arquivo físico será apagado e esta ação não poderá ser desfeita.`
    );
    if (!confirmed) return;

    setBusyTrackId(track.id);
    setError(null);
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
            disabled={loading || refreshing}
            onClick={() => void loadTracks(true)}
          >
            <RefreshCw className={refreshing ? 'is-spinning' : ''} />
          </button>
        </section>

        {error && <div className="admin-tracks-message is-error" role="alert">{error}</div>}

        {loading ? (
          <div className="admin-tracks-state" role="status"><LoaderCircle className="is-spinning" /> Carregando lixeira…</div>
        ) : filteredTracks.length === 0 ? (
          <div className="admin-tracks-state"><Trash2 /> {tracks.length === 0 ? 'A lixeira está vazia.' : 'Nenhuma música encontrada.'}</div>
        ) : (
          <section className="admin-quarantine-list" aria-label="Músicas na lixeira">
            <div className="admin-tracks-list__count">
              {filteredTracks.length.toLocaleString('pt-BR')} {filteredTracks.length === 1 ? 'música' : 'músicas'} na lixeira
            </div>
            {filteredTracks.map(track => (
              <article className="admin-quarantine-row" key={track.id}>
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
                    disabled={busyTrackId !== null}
                    onClick={() => void restoreTrack(track)}
                  >
                    {busyTrackId === track.id ? <LoaderCircle className="is-spinning" /> : <RotateCcw />}
                    Restaurar
                  </button>
                  <button
                    className="admin-quarantine-delete"
                    type="button"
                    disabled={busyTrackId !== null}
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
