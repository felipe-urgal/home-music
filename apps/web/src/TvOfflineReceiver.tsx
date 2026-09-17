import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { createTvLanReceiverSignaling } from './tv-lan-receiver-client';
import {
  clearTvRemoteMediaSources,
  filterTracksWithTvRemoteMediaSource,
  getTvRemoteMediaSource,
  setTvRemoteMediaSource
} from './tv-remote-media-source';
import { createTvRemoteDataChannel, type TvRemoteDataChannel } from './tv-remote-data-channel';
import { createTvRemotePeerController, type TvRemotePeerController, type TvRemotePeerState } from './tv-remote-peer';
import { wrapLanTvRemoteSessionTransport, type TvRemoteSessionTransport } from './tv-remote-session-transport';
import { applyTvRemotePlayerCommand, tvRemoteSnapshot } from './tv-remote-tv-controller';
import { useCrossfadeAudioPlayer } from './useCrossfadeAudioPlayer';
import './tv-offline-receiver.css';

type ReceiverStatus = 'starting' | 'waiting' | 'connected' | 'error';

function receivedTrack(trackId: string): Track {
  return {
    id: trackId,
    title: 'Música recebida do celular',
    artist: 'Home Music offline',
    album: 'Rede local',
    albumArtist: 'Home Music offline',
    folder: 'Offline local',
    folderPath: 'Offline local',
    duration: null,
    format: 'audio',
    hasCover: false
  };
}

export function TvOfflineReceiver() {
  const [status, setStatus] = useState<ReceiverStatus>('starting');
  const [detail, setDetail] = useState('Preparando conexão local…');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [readyTrackId, setReadyTrackId] = useState<string | null>(null);
  const peerRef = useRef<TvRemotePeerController | null>(null);
  const channelRef = useRef<TvRemoteDataChannel | null>(null);
  const transportRef = useRef<TvRemoteSessionTransport | null>(null);
  const receivedTracksRef = useRef(new Map<string, Track>());
  const committedTrackIdsRef = useRef(new Set<string>());
  const pendingPlayTrackIdRef = useRef<string | null>(null);
  const player = useCrossfadeAudioPlayer(tracks, true, true, false, { offlineMode: true });
  const playTrackRef = useRef(player.playTrack);
  playTrackRef.current = player.playTrack;
  const playerRef = useRef(player);
  playerRef.current = player;
  const readyTrack = useMemo(
    () => readyTrackId ? tracks.find(track => track.id === readyTrackId) ?? null : null,
    [readyTrackId, tracks]
  );

  useEffect(() => {
    committedTrackIdsRef.current = new Set(tracks.map(track => track.id));
    const pendingTrackId = pendingPlayTrackIdRef.current;
    if (!pendingTrackId || !committedTrackIdsRef.current.has(pendingTrackId)) return;
    const track = receivedTracksRef.current.get(pendingTrackId);
    if (!track || !getTvRemoteMediaSource(pendingTrackId)) {
      pendingPlayTrackIdRef.current = null;
      return;
    }
    pendingPlayTrackIdRef.current = null;
    playTrackRef.current(track, tracks);
  }, [tracks]);

  useEffect(() => {
    const channel = channelRef.current;
    if (!channel) return;
    try {
      channel.sendSnapshot(tvRemoteSnapshot({
        trackId: player.current?.id ?? null,
        title: player.current?.title ?? null,
        artist: player.current?.artist ?? null,
        playing: player.playing,
        currentTime: player.currentTime,
        duration: player.duration,
        shuffle: player.shuffle,
        repeatMode: player.repeatMode
      }));
    } catch {
      // Peer cleanup owns disconnected-channel errors.
    }
  }, [player.current?.id, player.current?.title, player.current?.artist, player.playing,
    player.currentTime, player.duration, player.shuffle, player.repeatMode]);

  useEffect(() => {
    let disposed = false;
    let signaling: Awaited<ReturnType<typeof createTvLanReceiverSignaling>> | null = null;

    const closeAttempt = () => {
      transportRef.current?.close();
      transportRef.current = null;
      channelRef.current?.close();
      channelRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
      signaling?.close();
      signaling = null;
      pendingPlayTrackIdRef.current = null;
    };

    const requireNewPairing = (message: string, nextStatus: ReceiverStatus = 'waiting') => {
      if (disposed) return;
      closeAttempt();
      setStatus(nextStatus);
      setDetail(`${message} Abra Menu → Novo pareamento offline para gerar um novo QR.`);
    };

    const updatePeerState = (next: TvRemotePeerState) => {
      if (disposed) return;
      if (next === 'open') {
        signaling?.finish();
        setStatus('connected');
        setDetail('Celular conectado pela rede local.');
      } else if (next === 'connecting') {
        setStatus('waiting');
        setDetail('Aguardando o celular concluir a conexão P2P…');
      } else if (next === 'unsupported') {
        closeAttempt();
        setStatus('error');
        setDetail('Este navegador interno não oferece WebRTC compatível.');
      } else if (next === 'error') {
        requireNewPairing('A conexão P2P local foi perdida.', 'error');
      } else if (next === 'closed') {
        requireNewPairing('Conexão com o celular encerrada.');
      }
    };

    const start = async () => {
      try {
        signaling = await createTvLanReceiverSignaling();
        if (disposed) {
          signaling.close();
          return;
        }

        const transport = wrapLanTvRemoteSessionTransport(signaling);
        transportRef.current = transport;
        const peer = createTvRemotePeerController({
          role: 'tv',
          sendSignal: signal => transport.sendSignal(signal),
          onState: updatePeerState,
          onError: error => {
            if (disposed || peerRef.current !== peer) return;
            requireNewPairing(
              error instanceof Error ? error.message : 'Falha na conexão P2P local.',
              'error'
            );
          },
          onChannel: channel => {
            if (disposed || peerRef.current !== peer) {
              channel.close();
              return;
            }
            channelRef.current?.close();
            const dataChannel = createTvRemoteDataChannel(channel, {
              onMedia: media => {
                const track = receivedTrack(media.trackId);
                setTvRemoteMediaSource(media.trackId, media.blob);
                receivedTracksRef.current.delete(media.trackId);
                receivedTracksRef.current.set(media.trackId, track);
                for (const trackId of Array.from(receivedTracksRef.current.keys())) {
                  if (!getTvRemoteMediaSource(trackId)) receivedTracksRef.current.delete(trackId);
                }
                setTracks(filterTracksWithTvRemoteMediaSource(Array.from(receivedTracksRef.current.values())));
                setReadyTrackId(media.trackId);
                setDetail('Música recebida e pronta para reprodução na TV.');
              },
              onCommand: command => {
                const current = playerRef.current;
                applyTvRemotePlayerCommand(command, {
                  currentTime: current.currentTime,
                  duration: current.duration
                }, {
                  togglePlay: current.togglePlay,
                  previous: current.previous,
                  next: current.next,
                  seek: current.seek,
                  toggleShuffle: current.toggleShuffle,
                  cycleRepeatMode: current.cycleRepeat,
                  playTrack: trackId => {
                    const track = receivedTracksRef.current.get(trackId);
                    if (!track || !getTvRemoteMediaSource(trackId)) {
                      setStatus('error');
                      setDetail('A música solicitada não está disponível offline na TV.');
                      return;
                    }
                    if (!committedTrackIdsRef.current.has(trackId)) {
                      pendingPlayTrackIdRef.current = trackId;
                      return;
                    }
                    playTrackRef.current(track, filterTracksWithTvRemoteMediaSource(
                      Array.from(receivedTracksRef.current.values())
                    ));
                  },
                  setCrossfade: current.setCrossfadeSeconds
                });
              },
              onDisconnect: () => {
                requireNewPairing('Celular desconectado.');
              },
              onError: error => {
                requireNewPairing(error.message, 'error');
              }
            });
            channelRef.current = dataChannel;
          }
        });
        peerRef.current = peer;
        transport.subscribeSignals(
          signal => peer.handleSignal(signal),
          error => {
            if (disposed || peerRef.current !== peer) return;
            requireNewPairing(error.message || 'Falha no signaling local.', 'error');
          }
        );
        setStatus('waiting');
        setDetail('Receiver offline pronto. Escaneie o QR exibido pela TV no celular.');
        await peer.start();
      } catch (error) {
        if (disposed) return;
        requireNewPairing(
          error instanceof Error ? error.message : 'Falha ao iniciar receiver offline local.',
          'error'
        );
      }
    };

    void start();
    return () => {
      disposed = true;
      closeAttempt();
      committedTrackIdsRef.current.clear();
      clearTvRemoteMediaSources();
      receivedTracksRef.current.clear();
    };
  }, []);

  const playReadyTrack = () => {
    if (!readyTrack || !getTvRemoteMediaSource(readyTrack.id)) return;
    player.playTrack(readyTrack, tracks);
  };

  return (
    <main className="tv-offline-receiver">
      <audio
        ref={player.deckARef}
        preload="auto"
        onPlay={event => player.audioHandlers.onPlay(event.currentTarget)}
        onPlaying={event => player.audioHandlers.onPlaying(event.currentTarget)}
        onPause={event => player.audioHandlers.onPause(event.currentTarget)}
        onWaiting={event => player.audioHandlers.onWaiting(event.currentTarget)}
        onCanPlay={event => player.audioHandlers.onCanPlay(event.currentTarget)}
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
        onWaiting={event => player.audioHandlers.onWaiting(event.currentTarget)}
        onCanPlay={event => player.audioHandlers.onCanPlay(event.currentTarget)}
        onTimeUpdate={event => player.audioHandlers.onTimeUpdate(event.currentTarget)}
        onLoadedMetadata={event => player.audioHandlers.onLoadedMetadata(event.currentTarget)}
        onEnded={event => player.audioHandlers.onEnded(event.currentTarget)}
        onError={event => player.audioHandlers.onError(event.currentTarget)}
      />

      <section className="tv-offline-receiver__card" aria-live="polite">
        <span className="tv-offline-receiver__badge">Modo offline local</span>
        <h1>Home Music TV</h1>
        <p className="tv-offline-receiver__status" data-status={status}>{detail}</p>

        {player.current ? (
          <div className="tv-offline-receiver__now-playing">
            <span>Tocando agora</span>
            <strong>{player.current.title}</strong>
            <small>{player.current.artist}</small>
            <button type="button" onClick={() => void player.togglePlay()}>
              {player.playing ? 'Pausar' : 'Continuar'}
            </button>
          </div>
        ) : readyTrack ? (
          <div className="tv-offline-receiver__ready">
            <strong>Mídia recebida do celular</strong>
            <p>O áudio está em memória na TV e não depende do servidor Home Music.</p>
            <button type="button" onClick={playReadyTrack}>Tocar música recebida</button>
          </div>
        ) : (
          <p className="tv-offline-receiver__hint">
            Mantenha esta tela aberta. Depois do pareamento, a música baixada no celular será enviada diretamente para a TV.
          </p>
        )}
      </section>
    </main>
  );
}
