import { useState } from 'react';
import { LibraryScreen } from './components/LibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { useAudioPlayer } from './useAudioPlayer';
import { useLibraryData } from './useLibraryData';
import { useLibraryNavigation } from './useLibraryNavigation';

type Screen = 'player' | 'library';

export default function App() {
  const [screen, setScreen] = useState<Screen>('player');
  const library = useLibraryData();
  const navigation = useLibraryNavigation(library.tracks, library.favoriteIds, library.playlists);
  const libraryReady = !library.loading && !library.error;
  const player = useAudioPlayer(library.tracks, screen === 'player', libraryReady);
  const current = player.current;

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
            tracksCount={library.tracks.length}
            queue={player.queue}
            currentIndex={player.currentIndex}
            playing={player.playing}
            autoplayBlocked={player.autoplayBlocked}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
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
