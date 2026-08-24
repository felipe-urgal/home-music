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
  const player = useAudioPlayer(library.tracks, screen === 'player');
  const current = player.current;

  function openPlayer() {
    player.syncVisibleProgress();
    setScreen('player');
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
        ) : !current ? (
          <div className="center-state">
            <strong>Nenhuma música encontrada</strong>
            <span>Confira MUSIC_DIR e use o botão de re-scan da biblioteca.</span>
          </div>
        ) : screen === 'player' ? (
          <PlayerScreen
            current={current}
            tracksCount={library.tracks.length}
            queue={player.queue}
            currentIndex={player.currentIndex}
            playing={player.playing}
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
            onToggleFavorite={() => void library.toggleFavorite(current.id).catch(() => undefined)}
            onPlayTrack={player.playTrack}
            onReorderQueue={player.reorderQueue}
            onAddToPlaylist={playlist => void library.addTrackToPlaylist(playlist, current.id).catch(() => undefined)}
          />
        ) : (
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
        )}
      </section>
    </main>
  );
}
