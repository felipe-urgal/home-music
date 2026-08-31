import { useState } from 'react';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopShell } from './components/DesktopShell';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import type { OfflineDownloads } from './offline-downloads';
import { useAudioPlayer } from './useAudioPlayer';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useDesktopLayout } from './useDesktopLayout';
import { useSystemVolumePreference } from './useSystemVolume';

type OfflineScreen = 'player' | 'library';

type OfflineAppProps = {
  offline: OfflineDownloads;
  onExit: () => void;
};

export function OfflineApp({ offline, onExit }: OfflineAppProps) {
  const [screen, setScreen] = useState<OfflineScreen>('library');
  const usesSystemVolume = useSystemVolumePreference();
  const desktopLayout = useDesktopLayout();
  const player = useAudioPlayer(
    offline.tracks,
    screen === 'player' || desktopLayout,
    !offline.loading,
    usesSystemVolume,
    { offlineMode: true }
  );
  useBackgroundPlaybackContinuity({
    audioRef: player.audioRef,
    queue: player.queue,
    currentIndex: player.currentIndex,
    currentTrackId: player.current?.id ?? null,
    repeatMode: player.repeatMode,
    playing: player.playing,
    onNext: player.next
  });
  const current = player.current;

  return (
    <main className="app-shell">
      <audio
        ref={player.audioRef}
        onPlay={player.audioHandlers.onPlay}
        onPause={player.audioHandlers.onPause}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={player.audioHandlers.onEnded}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />

      <DesktopShell
        active={screen === 'player' ? 'player' : 'library'}
        current={current}
        playing={player.playing}
        libraryCount={offline.tracks.length}
        queue={player.queue}
        currentIndex={player.currentIndex}
        offlineMode
        onOpenPlayer={() => setScreen('player')}
        onOpenLibrary={() => setScreen('library')}
        onPlayTrack={player.playTrack}
        onReorderQueue={player.reorderQueue}
        surfaceClassName={`phone-surface ${screen === 'library' ? 'phone-surface--library' : ''}`}
      >
        {offline.loading || (offline.tracks.length > 0 && !player.hydrated) ? (
          <ResponsiveState
            variant="loading"
            title="Preparando seus downloads"
            detail="Carregando as músicas salvas neste dispositivo."
          />
        ) : screen === 'library' ? (
          <OfflineLibraryScreen
            records={offline.records}
            current={current}
            playing={player.playing}
            hasNext={player.hasNext}
            totalBytes={offline.totalBytes}
            onOpenPlayer={() => setScreen('player')}
            onTogglePlay={() => void player.togglePlay()}
            onNext={player.next}
            onPlayTrack={(track, context) => {
              player.playTrack(track, context);
              setScreen('player');
            }}
            onRemove={trackId => { void offline.remove(trackId); }}
            onExitOffline={onExit}
          />
        ) : current ? (
          <PlayerScreen
            current={current}
            libraryReturnLabel="Voltar aos downloads"
            queue={player.queue}
            currentIndex={player.currentIndex}
            playing={player.playing}
            autoplayBlocked={player.autoplayBlocked}
            playbackError={player.sourceError}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
            usesSystemVolume={usesSystemVolume}
            shuffle={player.shuffle}
            repeatMode={player.repeatMode}
            playlists={[]}
            offlineMode
            onOpenLibrary={() => setScreen('library')}
            onTogglePlay={() => void player.togglePlay()}
            onPrevious={player.previous}
            onNext={player.next}
            onSeek={player.seek}
            onVolume={player.setVolume}
            onShuffle={player.toggleShuffle}
            onRepeat={player.cycleRepeat}
            onPlayTrack={player.playTrack}
            onReorderQueue={player.reorderQueue}
            onAddToPlaylist={() => undefined}
            onExitOffline={onExit}
          />
        ) : (
          <ResponsiveState
            variant="empty"
            title="Nenhum download offline"
            detail="Conecte ao Home Music e baixe uma música pelo player."
          >
            <button className="secondary-action" onClick={onExit}>Tentar conectar</button>
          </ResponsiveState>
        )}
      </DesktopShell>

      <DesktopPlayerBar
        current={current}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        usesSystemVolume={usesSystemVolume}
        hasNext={player.hasNext}
        offlineMode
        onOpenPlayer={() => setScreen('player')}
        onTogglePlay={() => void player.togglePlay()}
        onPrevious={player.previous}
        onNext={player.next}
        onSeek={player.seek}
        onVolume={player.setVolume}
      />
    </main>
  );
}
