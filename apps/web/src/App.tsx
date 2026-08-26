import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@home-music/shared';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopShell } from './components/DesktopShell';
import { LibraryScreen } from './components/LibraryScreen';
import { LoginScreen } from './components/LoginScreen';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import { StatisticsScreen } from './components/StatisticsScreen';
import { canUseAdminLibraryActions } from './frontend-access';
import { buildLibraryReturnLabel } from './library-utils';
import { type OfflineDownloads, useOfflineDownloads } from './offline-downloads';
import { useAudioPlayer } from './useAudioPlayer';
import { useAuth } from './useAuth';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useDesktopLayout } from './useDesktopLayout';
import { useLibraryData } from './useLibraryData';
import { type LibraryTab, useLibraryNavigation } from './useLibraryNavigation';
import { useNetworkQualityProfile } from './useNetworkQualityProfile';
import { useNextTrackPreload } from './useNextTrackPreload';
import { useSystemVolumePreference } from './useSystemVolume';

type Screen = 'player' | 'library' | 'statistics';

type AuthenticatedAppProps = {
  currentUser: AuthenticatedUser;
  onLogout: () => Promise<void>;
  offline: OfflineDownloads;
};

function AuthenticatedApp({ currentUser, onLogout, offline }: AuthenticatedAppProps) {
  const [screen, setScreen] = useState<Screen>('player');
  const library = useLibraryData();
  const navigation = useLibraryNavigation(library.tracks, library.favoriteIds, library.playlists);
  const libraryReady = !library.loading && !library.error;
  const usesSystemVolume = useSystemVolumePreference();
  const desktopLayout = useDesktopLayout();
  const player = useAudioPlayer(library.tracks, screen === 'player' || desktopLayout, libraryReady, usesSystemVolume);
  const qualityProfile = useNetworkQualityProfile(player.streamingMode, player.setStreamingMode);
  const canManageSharedLibrary = canUseAdminLibraryActions(currentUser);
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

  function openLibraryTab(tab: LibraryTab) {
    navigation.selectTab(tab);
    if (tab === 'history') run(library.refreshHistory());
    setScreen('library');
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
        activeLibraryTab={navigation.libraryTab}
        current={current}
        playing={player.playing}
        libraryCount={library.tracks.length}
        queue={player.queue}
        currentIndex={player.currentIndex}
        onOpenPlayer={openPlayer}
        onOpenLibrary={() => setScreen('library')}
        onOpenLibraryTab={openLibraryTab}
        onOpenStatistics={() => setScreen('statistics')}
        onPlayTrack={player.playTrack}
        onReorderQueue={player.reorderQueue}
        surfaceClassName={`phone-surface ${screen !== 'player' ? 'phone-surface--library' : ''}`}
      >
        {library.loading ? (
          <ResponsiveState
            variant="loading"
            title="Carregando sua biblioteca"
            detail="Sincronizando músicas, favoritos, histórico e playlists."
          />
        ) : library.error ? (
          <ResponsiveState variant="error" title="Servidor indisponível" detail={library.error}>
            <button className="primary-action" onClick={() => run(library.retry())}>Tentar novamente</button>
          </ResponsiveState>
        ) : library.tracks.length > 0 && !player.hydrated ? (
          <ResponsiveState
            variant="loading"
            title="Restaurando o player"
            detail="Recuperando sua fila e a última faixa reproduzida."
          />
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
            currentUser={currentUser}
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
          <ResponsiveState
            variant="empty"
            title="Nenhuma música encontrada"
            detail={canManageSharedLibrary
              ? 'Confira MUSIC_DIR ou atualize a biblioteca para procurar músicas novas.'
              : 'A biblioteca compartilhada ainda não possui músicas disponíveis.'}
          >
            {canManageSharedLibrary && (
              <button className="primary-action" disabled={library.scanning} onClick={() => run(library.rescan())}>
                {library.scanning ? 'Atualizando…' : 'Atualizar biblioteca'}
              </button>
            )}
            <button className="secondary-action" onClick={() => setScreen('library')}>Abrir biblioteca</button>
          </ResponsiveState>
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

      <DesktopPlayerBar
        current={current}
        playing={player.playing}
        currentTime={player.currentTime}
        duration={player.duration}
        volume={player.volume}
        usesSystemVolume={usesSystemVolume}
        hasNext={player.hasNext}
        onOpenPlayer={openPlayer}
        onTogglePlay={() => void player.togglePlay()}
        onPrevious={player.previous}
        onNext={player.next}
        onSeek={player.seek}
        onVolume={player.setVolume}
      />

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
        active={screen}
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

  if (!auth.authenticated || !auth.currentUser) {
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

  return <AuthenticatedApp currentUser={auth.currentUser} onLogout={auth.logout} offline={offline} />;
}
