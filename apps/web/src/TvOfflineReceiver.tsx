import { useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '@home-music/shared';
import { artworkFallbackDataUrl, buildArtworkFallback } from './artwork-utils';
import { createTvLanReceiverSignaling } from './tv-lan-receiver-client';
import {
  clearTvRemoteMediaSources,
  filterTracksWithTvRemoteMediaSource,
  getTvRemoteMediaSource,
  setTvRemoteMediaSource
} from './tv-remote-media-source';
import {
  createTvRemoteDataChannel,
  type TvRemoteDataChannel,
  type TvRemoteTrackMetadata
} from './tv-remote-data-channel';
import { createTvRemotePeerController, type TvRemotePeerController, type TvRemotePeerState } from './tv-remote-peer';
import { tvRemoteQrDataUrl } from './tv-remote-qr';
import { wrapLanTvRemoteSessionTransport, type TvRemoteSessionTransport } from './tv-remote-session-transport';
import { applyTvRemotePlayerCommand, tvRemoteSnapshot } from './tv-remote-tv-controller';
import { useCrossfadeAudioPlayer } from './useCrossfadeAudioPlayer';
import './tv-offline-receiver.css';

type ReceiverStatus = 'starting' | 'waiting' | 'connected' | 'error';

type PairingPreview = {
  qrText: string;
  expiresAt: number;
};

function receivedTrack(trackId: string, metadata?: TvRemoteTrackMetadata): Track {
  return {
    id: trackId,
    title: metadata?.title || 'Música recebida do celular',
    artist: metadata?.artist || 'Home Music offline',
    album: metadata?.album || 'Rede local',
    albumArtist: metadata?.artist || 'Home Music offline',
    folder: 'Offline local',
    folderPath: 'Offline local',
    duration: null,
    format: 'audio',
    hasCover: false
  };
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function parsePairingPreview(value: unknown): PairingPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (typeof data.qrText !== 'string' || !data.qrText.startsWith('home-music://tv-lan?')) return null;
  if (typeof data.expiresAt !== 'number' || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now()) return null;
  return { qrText: data.qrText, expiresAt: data.expiresAt };
}

export function TvOfflineReceiver() {
  const [status, setStatus] = useState<ReceiverStatus>('starting');
  const [detail, setDetail] = useState('Preparando conexão local…');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [readyTrackId, setReadyTrackId] = useState<string | null>(null);
  const [pairingPreview, setPairingPreview] = useState<PairingPreview | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);
  const peerRef = useRef<TvRemotePeerController | null>(null);
  const channelRef = useRef<TvRemoteDataChannel | null>(null);
  const transportRef = useRef<TvRemoteSessionTransport | null>(null);
  const closeSessionRef = useRef<() => void>(() => undefined);
  const receivedTracksRef = useRef(new Map<string, Track>());
  const trackMetadataRef = useRef(new Map<string, TvRemoteTrackMetadata>());
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
  const progress = player.duration > 0
    ? Math.max(0, Math.min(100, player.currentTime / player.duration * 100))
    : 0;
  const statusLabel = status === 'connected'
    ? 'Offline local ativo'
    : status === 'error'
      ? 'Conexão local indisponível'
      : 'Offline local';

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
    closeSessionRef.current = closeAttempt;

    const requireNewPairing = (message: string, nextStatus: ReceiverStatus = 'waiting') => {
      if (disposed) return;
      closeAttempt();
      setStatus(nextStatus);
      setDetail(`${message} Se necessário, escolha Novo pareamento para conectar novamente.`);
    };

    const updatePeerState = (next: TvRemotePeerState) => {
      if (disposed) return;
      if (next === 'open') {
        signaling?.finish();
        setStatus('connected');
        setPairingPreview(null);
        setDetail('Celular conectado pela rede local.');
        const current = playerRef.current;
        try {
          channelRef.current?.sendSnapshot(tvRemoteSnapshot({
            trackId: current.current?.id ?? null,
            title: current.current?.title ?? null,
            artist: current.current?.artist ?? null,
            playing: current.playing,
            currentTime: current.currentTime,
            duration: current.duration,
            shuffle: current.shuffle,
            repeatMode: current.repeatMode
          }));
        } catch {
          // O próximo update do player publica o snapshot novamente.
        }
      } else if (next === 'connecting') {
        setStatus('waiting');
        setDetail('Reconectando o celular pela rede local…');
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
              onTrackMetadata: metadata => {
                trackMetadataRef.current.set(metadata.trackId, metadata);
                const existing = receivedTracksRef.current.get(metadata.trackId);
                if (!existing) return;
                const updated = receivedTrack(metadata.trackId, metadata);
                receivedTracksRef.current.set(metadata.trackId, updated);
                setTracks(filterTracksWithTvRemoteMediaSource(Array.from(receivedTracksRef.current.values())));
              },
              onMedia: media => {
                const track = receivedTrack(media.trackId, trackMetadataRef.current.get(media.trackId));
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

            const current = playerRef.current;
            try {
              dataChannel.sendSnapshot(tvRemoteSnapshot({
                trackId: current.current?.id ?? null,
                title: current.current?.title ?? null,
                artist: current.current?.artist ?? null,
                playing: current.playing,
                currentTime: current.currentTime,
                duration: current.duration,
                shuffle: current.shuffle,
                repeatMode: current.repeatMode
              }));
            } catch {
              // O novo canal ainda pode estar finalizando a abertura.
            }
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
        setDetail('Receiver offline pronto. Conecte o celular pela rede local.');
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
      closeSessionRef.current = () => undefined;
      closeAttempt();
      committedTrackIdsRef.current.clear();
      clearTvRemoteMediaSources();
      receivedTracksRef.current.clear();
      trackMetadataRef.current.clear();
    };
  }, []);

  const playReadyTrack = () => {
    if (!readyTrack || !getTvRemoteMediaSource(readyTrack.id)) return;
    player.playTrack(readyTrack, tracks);
  };

  const disconnectPhone = () => {
    try { channelRef.current?.disconnect('tv-disconnect'); } catch { /* best effort */ }
    closeSessionRef.current();
    setStatus('waiting');
    setDetail('Celular desconectado. A música já recebida continua disponível na TV.');
  };

  const requestNewPairing = async () => {
    if (pairingBusy) return;
    setPairingBusy(true);
    try {
      try { channelRef.current?.disconnect('new-pairing'); } catch { /* best effort */ }
      closeSessionRef.current();
      const response = await fetch('/receiver/regenerate', {
        method: 'POST',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('Não foi possível gerar um novo pareamento.');
      const preview = parsePairingPreview(await response.json() as unknown);
      if (!preview) throw new Error('A TV retornou um novo pareamento inválido.');
      tvRemoteQrDataUrl(preview.qrText);
      setPairingPreview(preview);
      setStatus('waiting');
      setDetail('Novo QR pronto. Escaneie pelo Home Music no navegador ou PWA do celular.');
    } catch (error) {
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'Não foi possível gerar um novo pareamento.');
    } finally {
      setPairingBusy(false);
    }
  };

  const current = player.current;
  const displayTrack = current ?? readyTrack;
  const displayArtwork = displayTrack
    ? artworkFallbackDataUrl(buildArtworkFallback(displayTrack), 640)
    : null;

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

      <header className="tv-offline-receiver__header">
        <div className="tv-offline-receiver__brand">
          <span className="tv-offline-receiver__brand-bars" aria-hidden="true"><i /><i /><i /></span>
          <strong>Home Music TV</strong>
        </div>
        <span className="tv-offline-receiver__connection" data-status={status}>
          <span aria-hidden="true">⌁</span>
          {statusLabel}
          <i aria-hidden="true" />
        </span>
      </header>

      <section className="tv-offline-receiver__card" aria-live="polite">
        <div className="tv-offline-receiver__cover-column">
          <div className="tv-offline-receiver__cover" aria-hidden="true">
            {displayArtwork ? (
              <img src={displayArtwork} alt="" />
            ) : (
              <>
                <span>♪</span>
                <small>Home Music</small>
              </>
            )}
          </div>
          <p className="tv-offline-receiver__source">
            <span aria-hidden="true">▥</span>
            {current ? 'Reproduzindo do celular' : readyTrack ? 'Áudio recebido do celular' : 'Aguardando música do celular'}
          </p>
        </div>

        <div className="tv-offline-receiver__divider" aria-hidden="true" />

        <div className="tv-offline-receiver__details">
          <p className="tv-offline-receiver__status" data-status={status}>{detail}</p>

          {displayTrack ? (
            <>
              <h1>{displayTrack.title}</h1>
              <p className="tv-offline-receiver__artist">{displayTrack.artist}</p>
              <p className="tv-offline-receiver__album">{displayTrack.album}</p>
              <div
                className="tv-offline-receiver__progress"
                role="progressbar"
                aria-label={`${formatTime(player.currentTime)} de ${formatTime(player.duration)}`}
                aria-valuemin={0}
                aria-valuemax={Math.max(0, Math.round(player.duration))}
                aria-valuenow={Math.max(0, Math.round(player.currentTime))}
              >
                <span><i style={{ width: `${progress}%` }} /></span>
                <div><small>{formatTime(player.currentTime)}</small><small>{formatTime(player.duration)}</small></div>
              </div>
            </>
          ) : (
            <div className="tv-offline-receiver__empty">
              <h1>TV conectada e pronta</h1>
              <p>Escolha uma música baixada no celular para enviar diretamente pela rede local.</p>
            </div>
          )}

          <p className="tv-offline-receiver__lan">
            <span aria-hidden="true">↗</span>
            {status === 'connected'
              ? 'Celular conectado via rede local'
              : 'A reprodução já recebida continua na TV mesmo se o celular bloquear'}
          </p>
        </div>

        <div className="tv-offline-receiver__actions">
          <button
            type="button"
            className="tv-offline-receiver__primary"
            disabled={!displayTrack}
            onClick={() => current ? void player.togglePlay() : playReadyTrack()}
          >
            <span aria-hidden="true">{current && player.playing ? 'Ⅱ' : '▶'}</span>
            {current ? (player.playing ? 'Pausar' : 'Continuar') : 'Tocar'}
          </button>
          <button type="button" onClick={disconnectPhone}>
            <span aria-hidden="true">↗</span>
            Desconectar
          </button>
          <button type="button" disabled={pairingBusy} onClick={() => void requestNewPairing()}>
            <span aria-hidden="true">＋</span>
            {pairingBusy ? 'Gerando…' : 'Novo pareamento'}
          </button>
        </div>
      </section>

      {pairingPreview && (
        <div className="tv-offline-receiver__pairing-overlay">
          <section className="tv-offline-receiver__pairing" role="dialog" aria-modal="true" aria-label="Novo pareamento offline">
            <img src={tvRemoteQrDataUrl(pairingPreview.qrText)} alt="QR code para novo pareamento offline" />
            <div>
              <span className="tv-offline-receiver__badge">Offline local</span>
              <h2>Conectar novo celular</h2>
              <p>Abra os downloads do Home Music no navegador ou PWA e escaneie este QR. Não é necessário instalar a PWA.</p>
              <button type="button" onClick={() => setPairingPreview(null)}>Fechar QR</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
