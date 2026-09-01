import { AlertTriangle, CheckCircle2, Download, LoaderCircle, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import type {
  OfflineCollectionDownloadInput,
  OfflineCollectionTargetState
} from '../offline-downloads';

type OfflineCollectionControlProps = {
  target: OfflineCollectionDownloadInput;
  state: OfflineCollectionTargetState;
  onSync: (target: OfflineCollectionDownloadInput) => Promise<void>;
  onPause: () => void;
  onRemove: () => Promise<void>;
  onError: (error: unknown) => void;
};

function statusText(state: OfflineCollectionTargetState) {
  const progress = `${state.downloadedCount}/${state.totalCount}`;
  if (state.outdated) return `${progress} · conteúdo alterado`;
  if (state.status === 'available') return `${progress} · disponível offline`;
  if (state.status === 'downloading') return `${progress} · baixando`;
  if (state.status === 'paused') return `${progress} · pausado`;
  if (state.status === 'error') return `${progress} · requer nova tentativa`;
  if (state.status === 'partial') return `${progress} · parcial`;
  return `${state.totalCount} músicas`;
}

function MainIcon({ state }: { state: OfflineCollectionTargetState }) {
  if (state.status === 'downloading') return <LoaderCircle className="download-spinner" aria-hidden="true" />;
  if (state.status === 'available' && !state.outdated) return <CheckCircle2 aria-hidden="true" />;
  if (state.status === 'paused') return <Play aria-hidden="true" />;
  if (state.status === 'error') return <AlertTriangle aria-hidden="true" />;
  if (state.reference) return <RefreshCw aria-hidden="true" />;
  return <Download aria-hidden="true" />;
}

export function OfflineCollectionControl({
  target,
  state,
  onSync,
  onPause,
  onRemove,
  onError
}: OfflineCollectionControlProps) {
  const run = (operation: Promise<void>) => {
    void operation.catch(onError);
  };
  const canSync = target.tracks.length > 0;
  const complete = state.status === 'available' && !state.outdated;
  const pausing = state.status === 'paused' && state.downloadingCount > 0;

  return (
    <section className="offline-collection-control" aria-label={`Offline: ${target.name}`}>
      <div className="offline-collection-control__copy" aria-live="polite">
        <strong>Disponível offline</strong>
        <small>{statusText(state)}</small>
        {state.error && <small className="offline-collection-control__error">{state.error}</small>}
      </div>

      <div className="offline-collection-control__actions">
        {state.status === 'downloading' ? (
          <button className="secondary-action" type="button" onClick={onPause}>
            <Pause aria-hidden="true" />
            Pausar
          </button>
        ) : (
          <button
            className={complete ? 'secondary-action' : 'primary-action'}
            type="button"
            disabled={!canSync || complete || pausing}
            onClick={() => run(onSync(target))}
          >
            {pausing ? <LoaderCircle className="download-spinner" aria-hidden="true" /> : <MainIcon state={state} />}
            {complete
              ? 'Disponível'
              : pausing
                ? 'Pausando…'
                : state.status === 'paused'
                  ? 'Retomar'
                  : state.reference
                    ? 'Atualizar offline'
                    : 'Disponibilizar offline'}
          </button>
        )}

        {state.reference && (
          <button
            className="icon-button offline-collection-control__remove"
            type="button"
            aria-label={`Remover ${target.name} do modo offline`}
            onClick={() => {
              if (!window.confirm(`Remover “${target.name}” das coleções offline? Músicas usadas por outras referências serão preservadas.`)) return;
              run(onRemove());
            }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
}

export function offlineCollectionTracksByIds(trackIds: string[], tracks: Track[]) {
  const byId = new Map(tracks.map(track => [track.id, track]));
  return trackIds.map(trackId => byId.get(trackId)).filter((track): track is Track => Boolean(track));
}
