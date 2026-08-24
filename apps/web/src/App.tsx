import { useState } from 'react';
import { LibraryScreen } from './components/LibraryScreen';
import { LoginScreen } from './components/LoginScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { buildLibraryReturnLabel } from './library-utils';
import { useAudioPlayer } from './useAudioPlayer';
import { useAuth } from './useAuth';
import { useLibraryData } from './useLibraryData';
import { useLibraryNavigation } from './useLibraryNavigation';
import { useSystemVolumePreference } from './useSystemVolume';

type Screen = 'player' | 'library';

type AuthenticatedAppProps = {
  onLogout: () => Promise<void>;
};

function AuthenticatedApp({ onLogout }: AuthenticatedAppProps) {
  const [screen, setScreen] = useState<Screen>('player');
  const library = useLibraryData();
  const navigation = useLibraryNavigation(library.tracks, library.favoriteIds, library.playlists);
  const libraryReady = !library.loading && !library.error;
  const usesSystemVolume = useSystemVolumePreference();
  const player = useAudioPlayer(library.tracks, screen === 'player', libraryReady, usesSystemVolume);
  const current = player.current;
  const libraryReturnLabel = buildLibraryReturnLabel({
    selectedGroupName: navigation.selectedGroup?.name,
    selectedPlaylistName: navigation.selectedPlaylist?.name,
    libraryTab: navigation.libraryTab,
    folderPath: navigation.folderPath,
    folderName: navigation.folderView.name,
    query: navigation.query
  });

  function openPlayer() {
    player.syncVisibleProgress();
    setScreen('player');
  }

  function run(operation: Promise<unknown>) {
    void operation.catch(() => undefined);
  }

  return (
    <main className="app-shell">
      <audio
        ref={player.audioRef}
        onPlay={player.audioHandlers.onPlay}
        onPause={player.audioHandlers.onPause}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={player.audioHandlers.onEnded}
      />

      <section className={`phone-surface ${screen === 'library' ? 'phone-surface--library' : ''}`}>
        {library.loading ? (
          <div className="center-state">Carregando sua biblioteca…</div>
        ) : library.error ? (
          <div className="center-state">
            <strong>Servidor indisponível</strong>
            <span>{library.error}</span>
          </div>
        ) : library.tracks.length > 0 && !player.hydrated ? (
          <div className="center-state">Restaurando o player…</div>
        ) : screen === 'library' ? (
          <LibraryScreen
            data={library}
            current={current}
            playing={player.playing}
            hasNext={player.hasNext}
            navigation={navigation}
            onOpenPlayer={openPlayer}
            onTogglePlay={() => void player.togglePlay()}
            onNext={player.next}
            onPlayTrack={player.playTrack}
          />
        ) : !current ? (
          <div className="center-state center-state--actions">
            <strong>Nenhuma música encontrada</strong>
            <span>Confira MUSIC_DIR ou atualize a biblioteca para procurar músicas novas.</span>
            <button className="primary-action" disabled={library.scanning} onClick={() => run(library.rescan())}>
              {library.scanning ? 'Atualizando…' : 'Atualizar biblioteca'}
            </button>
            <button className="secondary-action" onClick={() => setScreen('library')}>Abrir biblioteca</button>
          </div>
        ) : (
          <PlayerScreen
            current={current}
            libraryReturnLabel={libraryReturnLabel}
            queue={player.queue}
            currentIndex={player.currentIndex}
            playing={player.playing}
            autoplayBlocked={player.autoplayBlocked}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
            usesSystemVolume={usesSystemVolume}
            shuffle={player.shuffle}
            repeatMode={player.repeatMode}
            isFavorite={library.favoriteSet.has(current.id)}
            playlists={library.playlists}
            onOpenLibrary={() => setScreen('library')}
            onTogglePlay={() => void player.togglePlay()}
            onPrevious={player.previous}
            onNext={player.next}
            onSeek={player.seek}
            onVolume={player.setVolume}
            onShuffle={player.toggleShuffle}
            onRepeat={player.cycleRepeat}
            onToggleFavorite={() => run(library.toggleFavorite(current.id))}
            onPlayTrack={player.playTrack}
            onReorderQueue={player.reorderQueue}
            onAddToPlaylist={playlist => run(library.addTrackToPlaylist(playlist, current.id))}
            onLogout={() => void onLogout()}
          />
        )}
      </section>

      {library.actionError && (
        <button className="app-toast" role="status" onClick={library.clearActionError}>
          {library.actionError}
        </button>
      )}
    </main>
  );
}

export default function App() {
  const auth = useAuth();

  if (auth.loading) {
    return (
      <main className="login-shell">
        <section className="login-card login-card--status" aria-live="polite">
          <strong>Home Music</strong>
          <span>Verificando sua sessão…</span>
        </section>
      </main>
    );
  }

  if (!auth.authenticated) {
    return (
      <LoginScreen
        configured={auth.configured}
        error={auth.error}
        onLogin={auth.login}
        onRetry={() => void auth.retry()}
      />
    );
  }

  return <AuthenticatedApp onLogout={auth.logout} />;
}
