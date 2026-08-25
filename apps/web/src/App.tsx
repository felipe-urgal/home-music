import { useEffect, useState } from 'react';
import { DesktopShell } from './components/DesktopShell';
import { LibraryScreen } from './components/LibraryScreen';
import { LoginScreen } from './components/LoginScreen';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { StatisticsScreen } from './components/StatisticsScreen';
import { buildLibraryReturnLabel } from './library-utils';
import { type OfflineDownloads, useOfflineDownloads } from './offline-downloads';
import { useAudioPlayer } from './useAudioPlayer';
import { useAuth } from './useAuth';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useLibraryData } from './useLibraryData';
import { useLibraryNavigation } from './useLibraryNavigation';
import { useNetworkQualityProfile } from './useNetworkQualityProfile';
import { useNextTrackPreload } from './useNextTrackPreload';
import { useSystemVolumePreference } from './useSystemVolume';

type Screen = 'player' | 'library' | 'statistics';

type AuthenticatedAppProps = {
  onLogout: () => Promise<void>;
  offline: OfflineDownloads;
};

function AuthenticatedApp({ onLogout, offline }: AuthenticatedAppProps) {
  const [screen, setScreen] = useState<Screen>('player');
  const library = useLibraryData();
  const navigation = useLibraryNavigation(library.tracks, library.favoriteIds, library.playlists);
  const libraryReady = !library.loading && !library.error;
  const usesSystemVolume = useSystemVolumePreference();
  const player = useAudioPlayer(library.tracks, screen === 'player', libraryReady, usesSystemVolume);
  const qualityProfile = useNetworkQualityProfile(player.streamingMode, player.setStreamingMode);
  useBackgroundPlaybackContinuity({
    audioRef: player.audioRef,
    queue: player.queue,
    currentIndex: player.currentIndex,
    currentTrackId: player.current?.id ?? null,
    repeatMode: player.repeatMode,
    playing: player.playing,
    onNext: player.next
  });
  useNextTrackPreload({
    queue: player.queue,
    currentIndex: player.currentIndex,
    repeatMode: player.repeatMode,
    streamingMode: player.streamingMode,
    normalizationMode: player.normalizationMode,
    playing: player.playing
  });
  const current = player.current;
  const editablePlaylists = library.playlists.filter(playlist => playlist.source === 'manual');
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

  function toggleDownload() {
    if (!current) return;
    if (offline.downloadedIds.has(current.id)) {
      if (!window.confirm(`Remover “${current.title}” dos downloads offline?`)) return;
      run(offline.remove(current.id).catch(error => {
        library.reportError(error);
        throw error;
      }));
      return;
    }

    run(offline.download(current).catch(error => {
      library.reportError(error);
      throw error;
    }));
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
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />

      <DesktopShell
        active={screen}
        current={current}
        playing={player.playing}
        libraryCount={library.tracks.length}
        queueCount={player.queue.length}
        onOpenPlayer={openPlayer}
        onOpenLibrary={() => setScreen('library')}
        onOpenStatistics={() => setScreen('statistics')}
        surfaceClassName={`phone-surface ${screen !== 'player' ? 'phone-surface--library' : ''}`}
      >
        {library.loading ? (
          <div className="center-state">Carregando sua biblioteca…</div>
        ) : library.error ? (
          <div className="center-state">
            <strong>Servidor indisponível</strong>
            <span>{library.error}</span>
          </div>
        ) : library.tracks.length > 0 && !player.hydrated ? (
          <div className="center-state">Restaurando o player…</div>
        ) : screen === 'statistics' ? (
          <StatisticsScreen
            onBack={() => setScreen('library')}
            onPlayTrack={track => {
              player.playTrack(track, library.tracks);
              setScreen('player');
            }}
          />
        ) : screen === 'library' ? (
          <LibraryScreen
            data={library}
            current={current}
            playing={player.playing}
            hasNext={player.hasNext}
            navigation={navigation}
            onOpenPlayer={openPlayer}
            onOpenStatistics={() => setScreen('statistics')}
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
            playbackError={player.sourceError}
            currentTime={player.currentTime}
            duration={player.duration}
            volume={player.volume}
            usesSystemVolume={usesSystemVolume}
            shuffle={player.shuffle}
            repeatMode={player.repeatMode}
            streamingSelection={qualityProfile.selection}
            effectiveStreamingMode={qualityProfile.effectiveMode}
            networkPreference={qualityProfile.networkPreference}
            detectedNetwork={qualityProfile.detectedNetwork}
            normalizationMode={player.normalizationMode}
            effectiveNormalizationMode={player.effectiveNormalizationMode}
            isFavorite={library.favoriteSet.has(current.id)}
            playlists={editablePlaylists}
            isDownloaded={offline.downloadedIds.has(current.id)}
            downloading={offline.downloadingIds.has(current.id)}
            onOpenLibrary={() => setScreen('library')}
            onTogglePlay={() => void player.togglePlay()}
            onPrevious={player.previous}
            onNext={player.next}
            onSeek={player.seek}
            onVolume={player.setVolume}
            onStreamingSelection={qualityProfile.setSelection}
            onNetworkPreference={qualityProfile.setNetworkPreference}
            onNormalizationMode={player.setNormalizationMode}
            onShuffle={player.toggleShuffle}
            onRepeat={player.cycleRepeat}
            onToggleFavorite={() => run(library.toggleFavorite(current.id))}
            onToggleDownload={offline.supported ? toggleDownload : undefined}
            onPlayTrack={player.playTrack}
            onReorderQueue={player.reorderQueue}
            onAddToPlaylist={playlist => run(library.addTrackToPlaylist(playlist, current.id))}
            onLogout={() => {
              void onLogout().catch(library.reportError);
            }}
          />
        )}
      </DesktopShell>

      {library.actionError && (
        <button className="app-toast" role="status" onClick={library.clearActionError}>
          {library.actionError}
        </button>
      )}
    </main>
  );
}

function OfflineApp({ offline, onExit }: { offline: OfflineDownloads; onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>('library');
  const usesSystemVolume = useSystemVolumePreference();
  const player = useAudioPlayer(offline.tracks, screen === 'player', !offline.loading, usesSystemVolume, { offlineMode: true });
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
        active={screen}
        current={current}
        playing={player.playing}
        libraryCount={offline.tracks.length}
        queueCount={player.queue.length}
        offlineMode
        onOpenPlayer={() => setScreen('player')}
        onOpenLibrary={() => setScreen('library')}
        surfaceClassName={`phone-surface ${screen === 'library' ? 'phone-surface--library' : ''}`}
      >
        {offline.loading || (offline.tracks.length > 0 && !player.hydrated) ? (
          <div className="center-state">Preparando seus downloads…</div>
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
            isFavorite={false}
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
            onToggleFavorite={() => undefined}
            onPlayTrack={player.playTrack}
            onReorderQueue={player.reorderQueue}
            onAddToPlaylist={() => undefined}
            onLogout={onExit}
            onExitOffline={onExit}
          />
        ) : (
          <div className="center-state center-state--actions">
            <strong>Nenhum download offline</strong>
            <button className="secondary-action" onClick={onExit}>Tentar conectar</button>
          </div>
        )}
      </DesktopShell>
    </main>
  );
}

export default function App() {
  const auth = useAuth();
  const offline = useOfflineDownloads();
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    if (offlineMode && !offline.loading && offline.tracks.length === 0) setOfflineMode(false);
  }, [offline.loading, offline.tracks.length, offlineMode]);

  if (offlineMode) {
    return (
      <OfflineApp
        offline={offline}
        onExit={() => {
          setOfflineMode(false);
          void auth.retry();
        }}
      />
    );
  }

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
    const offlineCount = auth.unreachable && offline.supported && !offline.loading ? offline.records.length : 0;
    return (
      <LoginScreen
        configured={auth.configured}
        error={auth.error}
        offlineCount={offlineCount}
        onLogin={auth.login}
        onRetry={() => void auth.retry()}
        onOpenOffline={offlineCount > 0 ? () => setOfflineMode(true) : undefined}
      />
    );
  }

  return <AuthenticatedApp onLogout={auth.logout} offline={offline} />;
}
