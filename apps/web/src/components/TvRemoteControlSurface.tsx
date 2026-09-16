import { useEffect, useMemo, useRef, useState } from 'react';
import type { OfflineDownloadRecord } from '../offline-downloads';
import { createTvRemoteMediaEndpoint, type TvRemoteMediaEndpoint } from '../tv-remote-media';
import { readTvRemoteOfflineMedia } from '../tv-remote-offline-media';
import { createTvRemotePeerController, type TvRemotePeerState } from '../tv-remote-peer';
import { createServerTvRemoteSessionTransport } from '../tv-remote-session-transport';
import { registerTvRemoteTrackPreflight } from '../tv-remote-track-preflight';
import { TvRemoteControlScreen } from './TvRemoteControlScreen';
import '../tv-remote-offline-cast.css';

type TvRemoteControlSurfaceProps = {
  sessionId: string;
  username: string;
  offlineRecords: readonly OfflineDownloadRecord[];
};

type TransferState = 'idle' | 'sending' | 'sent' | 'error';

export function TvRemoteControlSurface({ sessionId, username, offlineRecords }: TvRemoteControlSurfaceProps) {
  const downloadedIds = useMemo(() => new Set(offlineRecords.map(record => record.track.id)), [offlineRecords]);
  const downloadedIdsRef = useRef(downloadedIds);
  downloadedIdsRef.current = downloadedIds;
  const mediaEndpointRef = useRef<TvRemoteMediaEndpoint | null>(null);
  const peerStateRef = useRef<TvRemotePeerState>('connecting');
  const [peerState, setPeerState] = useState<TvRemotePeerState>('connecting');
  const [transferState, setTransferState] = useState<TransferState>('idle');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let eventStreamReady = false;
    let peerStarted = false;
    let clearStatusTimer: number | null = null;
    let mediaEndpoint: TvRemoteMediaEndpoint | null = null;

    const updatePeerState = (next: TvRemotePeerState) => {
      peerStateRef.current = next;
      if (!disposed) setPeerState(next);
    };

    const transport = createServerTvRemoteSessionTransport(sessionId);
    const peer = createTvRemotePeerController({
      role: 'remote',
      sendSignal: signal => transport.sendSignal(signal),
      onChannel: channel => {
        mediaEndpoint?.close();
        mediaEndpoint = createTvRemoteMediaEndpoint(channel);
        mediaEndpointRef.current = mediaEndpoint;
      },
      onState: updatePeerState,
      onError: cause => {
        if (disposed) return;
        setTransferState('error');
        setStatusText(cause instanceof Error ? cause.message : 'A conexão direta com a TV falhou.');
      }
    });

    const startPeer = () => {
      if (peerStarted || disposed) return;
      peerStarted = true;
      void peer.start().catch(() => undefined);
    };

    const stopSignals = transport.subscribeSignals(
      signal => {
        if (!eventStreamReady) return;
        return peer.handleSignal(signal);
      },
      undefined,
      // O servidor envia o replay antes de `ready`. O celular é sempre o initiator,
      // então ignora sinalização antiga de uma conexão anterior e cria uma offer nova
      // somente quando alcançou a borda ao vivo do stream.
      () => {
        eventStreamReady = true;
        startPeer();
      },
      () => {
        updatePeerState('closed');
        mediaEndpoint?.close();
        mediaEndpoint = null;
        mediaEndpointRef.current = null;
      }
    );

    const unregisterPreflight = registerTvRemoteTrackPreflight(sessionId, async trackId => {
      if (!downloadedIdsRef.current.has(trackId)) return;
      const endpoint = mediaEndpointRef.current;
      if (!endpoint || peerStateRef.current !== 'open') {
        if (!disposed) {
          setTransferState('idle');
          setStatusText('Áudio direto ainda não está pronto; a TV usará o servidor.');
        }
        return;
      }

      if (!disposed) {
        setTransferState('sending');
        setProgress(0);
        setStatusText('Enviando música baixada para a TV…');
      }

      try {
        const media = await readTvRemoteOfflineMedia(trackId);
        await endpoint.send(media, (sent, total) => {
          if (!disposed) setProgress(total > 0 ? Math.round(sent / total * 100) : 0);
        });
        if (!disposed) {
          setProgress(100);
          setTransferState('sent');
          setStatusText('Música enviada diretamente do celular.');
          if (clearStatusTimer !== null) window.clearTimeout(clearStatusTimer);
          clearStatusTimer = window.setTimeout(() => {
            setTransferState('idle');
            setStatusText(null);
          }, 3500);
        }
      } catch (cause) {
        if (!disposed) {
          setTransferState('error');
          setStatusText(cause instanceof Error ? cause.message : 'Não foi possível enviar a música para a TV.');
        }
        throw cause;
      }
    });

    return () => {
      disposed = true;
      if (clearStatusTimer !== null) window.clearTimeout(clearStatusTimer);
      unregisterPreflight();
      stopSignals();
      transport.close();
      mediaEndpoint?.close();
      mediaEndpointRef.current = null;
      peer.close();
    };
  }, [sessionId]);

  const showDirectStatus = downloadedIds.size > 0 && (
    transferState !== 'idle' || peerState === 'open' || statusText !== null
  );
  const directStatusText = transferState === 'sending'
    ? `${statusText ?? 'Enviando para a TV…'} ${progress}%`
    : statusText ?? (peerState === 'open' ? 'Áudio direto pronto para seus downloads.' : null);

  return (
    <>
      <TvRemoteControlScreen sessionId={sessionId} username={username} />
      {showDirectStatus && directStatusText && (
        <div
          className={`tv-remote-offline-cast tv-remote-offline-cast--${transferState}`}
          role={transferState === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <strong>{transferState === 'sending' ? 'Celular → TV' : 'Downloads no celular'}</strong>
          <span>{directStatusText}</span>
          {transferState === 'sending' && (
            <span className="tv-remote-offline-cast__progress" aria-hidden="true">
              <i style={{ width: `${progress}%` }} />
            </span>
          )}
        </div>
      )}
    </>
  );
}
