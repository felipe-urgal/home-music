import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { DesktopPlayerBar } from './components/DesktopPlayerBar';
import { DesktopShell } from './components/DesktopShell';
import { OfflineLibraryScreen } from './components/OfflineLibraryScreen';
import { PlayerScreen } from './components/PlayerScreen';
import { ResponsiveState } from './components/ResponsiveState';
import { offlineAudioUrl, type OfflineDownloads } from './offline-downloads';
import './offline-mobile.css';
import { createTvLanRemoteSignaling } from './tv-lan-remote-client';
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
  const tvTransportRef = useRef<TvRemoteSessionTransport | null>(null);
  const tvPeerRef = useRef<TvRemotePeerController | null>(null);
  const tvChannelRef = useRef<TvRemoteDataChannel | null>(null);
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
  const current = player.current;

  const closeTvSession = useCallback(() => {
    tvChannelRef.current?.close();
    tvChannelRef.current = null;
    tvPeerRef.current?.close();
    tvPeerRef.current = null;
    tvTransportRef.current?.close();
    tvTransportRef.current = null;
  }, []);

  useEffect(() => () => closeTvSession(), [closeTvSession]);

  const failTvSession = useCallback((error: unknown) => {
    closeTvSession();
    setTvState('disconnected');
    setTvMessage(tvErrorMessage(error));
  }, [closeTvSession]);

  const connectTv = useCallback(async () => {
    const qrText = window.prompt('Cole o conteúdo do QR de pareamento exibido pela TV:');
    if (!qrText?.trim()) return;

    closeTvSession();
    setTvState('connecting');
    setTvMessage('Conectando diretamente à TV pela rede local…');

    try {
      const signaling = await createTvLanRemoteSignaling(qrText);
      const transport = wrapLanTvRemoteSessionTransport(signaling);
      tvTransportRef.current = transport;
      let peer: TvRemotePeerController;
      const updatePeerState = (next: TvRemotePeerState) => {
        if (next === 'open') {
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
              setTvMessage(snapshot.trackId
                ? `${snapshot.playing ? 'Tocando' : 'Pausada'} na TV: ${snapshot.title ?? 'música offline'}.`
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
      failTvSession(error);
    }
  }, [closeTvSession, failTvSession]);

  const disconnectTv = useCallback(() => {
    closeTvSession();
    setTvState('disconnected');
    setTvMessage('TV desconectada.');
  }, [closeTvSession]);

  const sendTrackToTv = useCallback(async (track: Track) => {
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
  }, [offline.records, tvState]);

  const playTrack = useCallback((track: Track, context: Track[]) => {
    if (tvState === 'connecting') {
      setTvMessage('Aguarde a conexão com a TV terminar.');
      return;
    }
    if (tvState === 'connected' || tvState === 'sending') {
      void sendTrackToTv(track);
      return;
    }
    player.playTrack(track, context);
    setScreen('player');
  }, [player.playTrack, sendTrackToTv, tvState]);

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
        current={current}
        playing={player.playing}
        currentTime={player.currentTime}
        libraryCount={offline.tracks.length}
        queue={player.queue}
        currentIndex={player.currentIndex}
        offlineMode
        onOpenPlayer={() => setScreen('player')}
        onOpenLibrary={() => setScreen('library')}
        onPlayTrack={player.playTrack}
        onReorderQueue={player.reorderQueue}
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
            current={current}
            playing={player.playing}
            hasNext={player.hasNext}
            totalBytes={offline.totalBytes}
            tvState={tvState}
            tvMessage={tvMessage}
            onTvConnect={() => { void connectTv(); }}
            onTvDisconnect={disconnectTv}
            onOpenPlayer={() => setScreen('player')}
            onTogglePlay={() => void player.togglePlay()}
            onNext={player.next}
            onPlayTrack={playTrack}
            onRemove={trackId => { void offline.remove(trackId).catch(() => undefined); }}
            onRemoveCollection={(kind, sourceId) => { void offline.removeCollection(kind, sourceId).catch(() => undefined); }}
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
            detail="Conecte ao Home Music e disponibilize músicas, playlists ou pastas para uso offline."
          >
            <button className="secondary-action" type="button" onClick={onExit}>Tentar conectar</button>
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
