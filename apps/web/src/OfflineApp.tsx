import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopShell } from './components/DesktopShell';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import { offlineAudioUrl, type OfflineDownloads } from './offline-downloads';
import './offline-mobile.css';
import { createTvLanRemoteSignaling } from './tv-lan-remote-client';
import { TvLanQrScanner } from './TvLanQrScanner';
import { createTvRemoteDataChannel, type TvRemoteDataChannel } from './tv-remote-data-channel';
import { createTvRemotePeerController, type TvRemotePeerController, type TvRemotePeerState } from './tv-remote-peer';
import { wrapLanTvRemoteSessionTransport, type TvRemoteSessionTransport } from './tv-remote-session-transport';
import { useBackgroundPlaybackContinuity } from './useBackgroundPlaybackContinuity';
import { useCrossfadeAudioPlayer } from './useCrossfadeAudioPlayer';
import { useDesktopLayout } from './useDesktopLayout';
import { useSystemVolumePreference } from './useSystemVolume';

type OfflineScreen = 'player' | 'library';
type TvLanState = 'disconnected' | 'connecting' | 'connected' | 'sending';

type OfflineAppProps = {
  offline: OfflineDownloads;
  onExit: () => void;
};

function tvErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Falha na conexão local com a TV.';
}

export function OfflineApp({ offline, onExit }: OfflineAppProps) {
  const [screen, setScreen] = useState<OfflineScreen>('library');
  const [tvState, setTvState] = useState<TvLanState>('disconnected');
  const [tvMessage, setTvMessage] = useState<string | null>(null);
  const [tvSnapshot, setTvSnapshot] = useState<TvRemotePlaybackSnapshot | null>(null);
  const [tvTrackId, setTvTrackId] = useState<string | null>(null);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const tvTransportRef = useRef<TvRemoteSessionTransport | null>(null);
  const tvPeerRef = useRef<TvRemotePeerController | null>(null);
  const tvChannelRef = useRef<TvRemoteDataChannel | null>(null);
  const tvConnectAbortRef = useRef<AbortController | null>(null);
  const tvQueueRef = useRef<Track[]>(offline.tracks);
  const usesSystemVolume = useSystemVolumePreference();
  const desktopLayout = useDesktopLayout();
  const player = useCrossfadeAudioPlayer(
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

  const tvActive = tvState === 'connected' || tvState === 'sending';

  const pauseLocalPlayback = useCallback(() => {
    player.deckARef.current?.pause();
    player.deckBRef.current?.pause();
  }, [player.deckARef, player.deckBRef]);

  const closeTvSession = useCallback(() => {
    tvConnectAbortRef.current?.abort();
    tvConnectAbortRef.current = null;
    try { tvChannelRef.current?.disconnect('remote-closed'); } catch { /* channel may already be closed */ }
    tvChannelRef.current?.close();
    tvChannelRef.current = null;
    tvPeerRef.current?.close();
    tvPeerRef.current = null;
    tvTransportRef.current?.close();
    tvTransportRef.current = null;
  }, []);

  useEffect(() => () => closeTvSession(), [closeTvSession]);

  useEffect(() => {
    if (!tvActive) tvQueueRef.current = offline.tracks;
  }, [offline.tracks, tvActive]);

  const failTvSession = useCallback((error: unknown) => {
    closeTvSession();
    setTvState('disconnected');
    setTvSnapshot(null);
    setTvTrackId(null);
    setTvMessage(tvErrorMessage(error));
  }, [closeTvSession]);

  const connectTv = useCallback(async (qrText: string) => {
    setQrScannerOpen(false);
    closeTvSession();
    setTvSnapshot(null);
    setTvTrackId(null);
    setTvState('connecting');
    setTvMessage('Conectando diretamente à TV pela rede local…');
    const abortController = new AbortController();
    tvConnectAbortRef.current = abortController;

    try {
      const signaling = await createTvLanRemoteSignaling(qrText, { signal: abortController.signal });
      if (abortController.signal.aborted) {
        signaling.close();
        return;
      }
      const transport = wrapLanTvRemoteSessionTransport(signaling);
      tvTransportRef.current = transport;
      let peer: TvRemotePeerController;
      const updatePeerState = (next: TvRemotePeerState) => {
        if (next === 'open') {
          pauseLocalPlayback();
          setTvState('connected');
          setTvMessage(`TV conectada em ${signaling.pairing.host}.`);
        } else if (next === 'connecting') {
          setTvState('connecting');
          setTvMessage('Abrindo conexão P2P com a TV…');
        } else if (next === 'unsupported') {
          failTvSession(new Error('Este navegador não oferece WebRTC compatível.'));
        } else if (next === 'error') {
          failTvSession(new Error('Não foi possível abrir a conexão P2P com a TV.'));
        } else if (next === 'closed' && tvPeerRef.current === peer) {
          closeTvSession();
          setTvState('disconnected');
          setTvSnapshot(null);
          setTvTrackId(null);
          setTvMessage('Conexão com a TV encerrada.');
        }
      };

      peer = createTvRemotePeerController({
        role: 'remote',
        sendSignal: signal => transport.sendSignal(signal),
        onState: updatePeerState,
        onError: failTvSession,
        onChannel: channel => {
          tvChannelRef.current?.close();
          tvChannelRef.current = createTvRemoteDataChannel(channel, {
            onSnapshot: snapshot => {
              setTvSnapshot(snapshot);
              if (snapshot.trackId) setTvTrackId(snapshot.trackId);
              const track = snapshot.trackId ? offline.tracks.find(item => item.id === snapshot.trackId) : null;
              setTvMessage(snapshot.trackId
                ? `${snapshot.playing ? 'Tocando' : 'Pausada'} na TV: ${track?.title ?? snapshot.title ?? 'música offline'}.`
                : 'TV conectada e pronta.');
            },
            onDisconnect: () => failTvSession(new Error('A TV encerrou a sessão local.')),
            onError: failTvSession
          });
        }
      });
      tvPeerRef.current = peer;
      transport.subscribeSignals(
        signal => peer.handleSignal(signal),
        error => failTvSession(error)
      );
      await peer.start();
    } catch (error) {
      if (abortController.signal.aborted) return;
      failTvSession(error);
    } finally {
      if (tvConnectAbortRef.current === abortController) tvConnectAbortRef.current = null;
    }
  }, [closeTvSession, failTvSession, offline.tracks, pauseLocalPlayback]);

  const disconnectTv = useCallback(() => {
    closeTvSession();
    setTvState('disconnected');
    setTvSnapshot(null);
    setTvTrackId(null);
    setTvMessage('TV desconectada.');
  }, [closeTvSession]);

  const sendTvCommand = useCallback((command: TvRemoteCommand) => {
    const channel = tvChannelRef.current;
    if (!channel) {
      failTvSession(new Error('A conexão P2P com a TV não está pronta. Conecte novamente.'));
      return false;
    }
    try {
      channel.sendCommand(command);
      return true;
    } catch (error) {
      failTvSession(error);
      return false;
    }
  }, [failTvSession]);

  const sendTrackToTv = useCallback(async (track: Track, context?: Track[]) => {
    const endpoint = tvChannelRef.current;
    if (!endpoint) {
      setTvState('disconnected');
      setTvMessage('A conexão P2P com a TV não está pronta. Conecte novamente.');
      return;
    }
    if (tvState === 'sending') {
      setTvMessage('Aguarde o envio atual terminar antes de escolher outra música.');
      return;
    }

    pauseLocalPlayback();
    if (context?.length) tvQueueRef.current = context;
    setTvTrackId(track.id);
    setTvSnapshot(null);
    setTvState('sending');
    setTvMessage(`Enviando “${track.title}” para a TV…`);
    try {
      const response = await fetch(offlineAudioUrl(track.id));
      if (!response.ok) throw new Error('O download offline selecionado não está mais disponível neste dispositivo.');
      const blob = await response.blob();
      const record = offline.records.find(item => item.track.id === track.id);
      await endpoint.sendTrackAndPlay({
        trackId: track.id,
        blob,
        mimeType: record?.mimeType || blob.type
      });
      setTvState('connected');
      setTvMessage(`“${track.title}” enviada para a TV.`);
    } catch (error) {
      setTvState(tvChannelRef.current ? 'connected' : 'disconnected');
      setTvMessage(tvErrorMessage(error));
    }
  }, [offline.records, pauseLocalPlayback, tvState]);

  const playTrack = useCallback((track: Track, context: Track[]) => {
    if (tvState === 'connecting') {
      setTvMessage('Aguarde a conexão com a TV terminar.');
      return;
    }
    if (tvActive) {
      void sendTrackToTv(track, context);
      return;
    }
    player.playTrack(track, context);
    setScreen('player');
  }, [player.playTrack, sendTrackToTv, tvActive, tvState]);

  const remoteTrackId = tvSnapshot?.trackId ?? tvTrackId;
  const remoteQueue = tvQueueRef.current.length > 0 ? tvQueueRef.current : offline.tracks;
  const remoteIndex = remoteTrackId ? remoteQueue.findIndex(track => track.id === remoteTrackId) : -1;
  const remoteCurrent = remoteTrackId ? offline.tracks.find(track => track.id === remoteTrackId) ?? null : null;
  const displayCurrent = tvActive ? remoteCurrent : player.current;
  const displayPlaying = tvActive ? Boolean(tvSnapshot?.playing) : player.playing;
  const displayCurrentTime = tvActive ? (tvSnapshot?.currentTime ?? 0) : player.currentTime;
  const displayDuration = tvActive ? (tvSnapshot?.duration ?? 0) : player.duration;
  const displayShuffle = tvActive ? Boolean(tvSnapshot?.shuffle) : player.shuffle;
  const displayRepeatMode = tvActive ? (tvSnapshot?.repeatMode ?? 'off') : player.repeatMode;
  const displayQueue = tvActive ? remoteQueue : player.queue;
  const displayCurrentIndex = tvActive ? remoteIndex : player.currentIndex;
  const displayHasNext = tvActive
    ? remoteIndex >= 0 && (remoteIndex < remoteQueue.length - 1 || displayRepeatMode === 'all')
    : player.hasNext;

  const togglePlayback = useCallback(() => {
    if (tvActive) sendTvCommand({ type: 'toggle-play' });
    else void player.togglePlay();
  }, [player.togglePlay, sendTvCommand, tvActive]);

  const adjacentTrack = useCallback((direction: -1 | 1) => {
    if (!tvActive) {
      if (direction < 0) player.previous();
      else player.next();
      return;
    }
    const queue = tvQueueRef.current;
    const id = tvSnapshot?.trackId ?? tvTrackId;
    const index = id ? queue.findIndex(track => track.id === id) : -1;
    if (index < 0 || queue.length === 0) return;
    let targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= queue.length) {
      if ((tvSnapshot?.repeatMode ?? 'off') !== 'all') return;
      targetIndex = targetIndex < 0 ? queue.length - 1 : 0;
    }
    const target = queue[targetIndex];
    if (target) void sendTrackToTv(target, queue);
  }, [player.next, player.previous, sendTrackToTv, tvActive, tvSnapshot?.repeatMode, tvSnapshot?.trackId, tvTrackId]);

  const seekPlayback = useCallback((seconds: number) => {
    if (tvActive) sendTvCommand({ type: 'seek-to', seconds });
    else player.seek(seconds);
  }, [player.seek, sendTvCommand, tvActive]);

  const toggleShuffle = useCallback(() => {
    if (tvActive) sendTvCommand({ type: 'toggle-shuffle' });
    else player.toggleShuffle();
  }, [player.toggleShuffle, sendTvCommand, tvActive]);

  const cycleRepeat = useCallback(() => {
    if (tvActive) sendTvCommand({ type: 'cycle-repeat' });
    else player.cycleRepeat();
  }, [player.cycleRepeat, sendTvCommand, tvActive]);

  return (
    <main className="app-shell">
      <audio
        ref={player.deckARef}
        preload="auto"
        onPlay={event => player.audioHandlers.onPlay(event.currentTarget)}
        onPlaying={event => player.audioHandlers.onPlaying(event.currentTarget)}
        onPause={event => player.audioHandlers.onPause(event.currentTarget)}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={event => player.audioHandlers.onEnded(event.currentTarget)}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />
      <audio
        ref={player.deckBRef}
        preload="auto"
        aria-hidden="true"
        onPlay={event => player.audioHandlers.onPlay(event.currentTarget)}
        onPlaying={event => player.audioHandlers.onPlaying(event.currentTarget)}
        onPause={event => player.audioHandlers.onPause(event.currentTarget)}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={event => player.audioHandlers.onEnded(event.currentTarget)}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />

      <DesktopShell
        active={screen === 'player' ? 'player' : 'library'}
        current={displayCurrent}
        playing={displayPlaying}
        currentTime={displayCurrentTime}
        libraryCount={offline.tracks.length}
        queue={displayQueue}
        currentIndex={displayCurrentIndex}
        offlineMode
        onOpenPlayer={() => setScreen('player')}
        onOpenLibrary={() => setScreen('library')}
        onPlayTrack={playTrack}
        onReorderQueue={tvActive ? () => undefined : player.reorderQueue}
        surfaceClassName={`phone-surface phone-surface--offline ${screen === 'library' ? 'phone-surface--library' : ''}`}
      >
        {offline.loading || (offline.tracks.length > 0 && !player.hydrated) ? (
          <ResponsiveState
            variant="loading"
            title="Preparando seus downloads"
            detail="Carregando as músicas e coleções salvas neste dispositivo."
          />
        ) : screen === 'library' ? (
          <OfflineLibraryScreen
            records={offline.records}
            collections={offline.collections}
            individualTrackIds={offline.individualDownloadedIds}
            current={displayCurrent ?? undefined}
            playing={displayPlaying}
            hasNext={displayHasNext}
            totalBytes={offline.totalBytes}
            tvState={tvState}
            tvMessage={tvMessage}
            onTvConnect={() => setQrScannerOpen(true)}
            onTvDisconnect={disconnectTv}
            onOpenPlayer={() => setScreen('player')}
            onTogglePlay={togglePlayback}
            onNext={() => adjacentTrack(1)}
            onPlayTrack={playTrack}
            onRemove={trackId => { void offline.remove(trackId).catch(() => undefined); }}
            onRemoveCollection={(kind, sourceId) => { void offline.removeCollection(kind, sourceId).catch(() => undefined); }}
            onExitOffline={onExit}
          />
        ) : displayCurrent ? (
          <PlayerScreen
            current={displayCurrent}
            libraryReturnLabel="Voltar aos downloads"
            queue={displayQueue}
            currentIndex={displayCurrentIndex}
            playing={displayPlaying}
            autoplayBlocked={tvActive ? false : player.autoplayBlocked}
            playbackError={tvActive ? null : player.sourceError}
            currentTime={displayCurrentTime}
            duration={displayDuration}
            volume={player.volume}
            usesSystemVolume={usesSystemVolume || tvActive}
            shuffle={displayShuffle}
            repeatMode={displayRepeatMode}
            playlists={[]}
            offlineMode
            onOpenLibrary={() => setScreen('library')}
            onTogglePlay={togglePlayback}
            onPrevious={() => adjacentTrack(-1)}
            onNext={() => adjacentTrack(1)}
            onSeek={seekPlayback}
            onVolume={player.setVolume}
            onShuffle={toggleShuffle}
            onRepeat={cycleRepeat}
            onPlayTrack={playTrack}
            onReorderQueue={tvActive ? () => undefined : player.reorderQueue}
            onAddToPlaylist={() => undefined}
            onExitOffline={onExit}
          />
        ) : (
          <ResponsiveState
            variant="empty"
            title={tvActive ? 'TV conectada e pronta' : 'Nenhum download offline'}
            detail={tvActive
              ? 'Escolha uma música nos downloads para enviar à TV.'
              : 'Conecte ao Home Music e disponibilize músicas, playlists ou pastas para uso offline.'}
          >
            <button className="secondary-action" type="button" onClick={() => setScreen('library')}>Voltar aos downloads</button>
          </ResponsiveState>
        )}
      </DesktopShell>

      <DesktopPlayerBar
        current={displayCurrent}
        playing={displayPlaying}
        currentTime={displayCurrentTime}
        duration={displayDuration}
        volume={player.volume}
        usesSystemVolume={usesSystemVolume || tvActive}
        hasNext={displayHasNext}
        offlineMode
        onOpenPlayer={() => setScreen('player')}
        onTogglePlay={togglePlayback}
        onPrevious={() => adjacentTrack(-1)}
        onNext={() => adjacentTrack(1)}
        onSeek={seekPlayback}
        onVolume={player.setVolume}
      />

      <TvLanQrScanner
        open={qrScannerOpen}
        onDetected={value => { void connectTv(value); }}
        onCancel={() => setQrScannerOpen(false)}
      />
    </main>
  );
}
