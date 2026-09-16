import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { createTvLanReceiverSignaling } from './tv-lan-receiver-client';
import { clearTvRemoteMediaSources, getTvRemoteMediaSource, setTvRemoteMediaSource } from './tv-remote-media-source';
import { createTvRemoteMediaEndpoint, type TvRemoteMediaEndpoint } from './tv-remote-media';
import { createTvRemotePeerController, type TvRemotePeerController, type TvRemotePeerState } from './tv-remote-peer';
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
  const mediaRef = useRef<TvRemoteMediaEndpoint | null>(null);
  const player = useCrossfadeAudioPlayer(tracks, true, true, false, { offlineMode: true });
  const readyTrack = useMemo(
    () => readyTrackId ? tracks.find(track => track.id === readyTrackId) ?? null : null,
    [readyTrackId, tracks]
  );

  useEffect(() => {
    let disposed = false;
    let signaling: Awaited<ReturnType<typeof createTvLanReceiverSignaling>> | null = null;

    const updatePeerState = (next: TvRemotePeerState) => {
      if (disposed) return;
      if (next === 'open') {
        setStatus('connected');
        setDetail('Celular conectado pela rede local.');
      } else if (next === 'connecting') {
        setStatus('waiting');
        setDetail('Aguardando o celular concluir a conexão P2P…');
      } else if (next === 'unsupported') {
        setStatus('error');
        setDetail('Este navegador interno não oferece WebRTC compatível.');
      } else if (next === 'error') {
        setStatus('error');
        setDetail('Não foi possível abrir a conexão P2P local.');
      } else if (next === 'closed') {
        setStatus('waiting');
        setDetail('Conexão encerrada. Gere um novo pareamento se necessário.');
      }
    };

    const start = async () => {
      try {
        signaling = await createTvLanReceiverSignaling();
        if (disposed) {
          signaling.close();
          return;
        }

        const peer = createTvRemotePeerController({
          role: 'tv',
          sendSignal: signal => signaling!.sendSignal(signal),
          onState: updatePeerState,
          onError: error => {
            if (disposed) return;
            setStatus('error');
            setDetail(error instanceof Error ? error.message : 'Falha na conexão P2P local.');
          },
          onChannel: channel => {
            if (disposed) {
              channel.close();
              return;
            }
            mediaRef.current?.close();
            mediaRef.current = createTvRemoteMediaEndpoint(channel, {
              onReceive: media => {
                setTvRemoteMediaSource(media.trackId, media.blob);
                setTracks(current => {
                  if (current.some(track => track.id === media.trackId)) return current;
                  return [...current, receivedTrack(media.trackId)];
                });
                setReadyTrackId(media.trackId);
                setDetail('Música recebida. Pronta para tocar sem servidor.');
              }
            });
          }
        });
        peerRef.current = peer;
        signaling.start(
          signal => peer.handleSignal(signal),
          error => {
            if (disposed) return;
            setStatus('error');
            setDetail(error instanceof Error ? error.message : 'Falha no signaling local.');
          }
        );
        setStatus('waiting');
        setDetail('Receiver offline pronto. Escaneie o QR exibido pela TV no celular.');
        await peer.start();
      } catch (error) {
        if (disposed) return;
        setStatus('error');
        setDetail(error instanceof Error ? error.message : 'Falha ao iniciar receiver offline local.');
      }
    };

    void start();
    return () => {
      disposed = true;
      signaling?.close();
      mediaRef.current?.close();
      mediaRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
      clearTvRemoteMediaSources();
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
