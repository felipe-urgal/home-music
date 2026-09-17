import type { TvRemotePeerRole, TvRemoteSignal } from '@home-music/shared/tv-remote';

export const TV_REMOTE_MEDIA_CHANNEL = 'home-music-media-v1';

export type TvRemotePeerState = 'connecting' | 'open' | 'closed' | 'unsupported' | 'error';

export type TvRemotePeerController = {
  start: () => Promise<void>;
  handleSignal: (signal: TvRemoteSignal) => Promise<void>;
  close: () => void;
};

type PeerOptions = {
  role: TvRemotePeerRole;
  sendSignal: (signal: TvRemoteSignal) => Promise<void>;
  onChannel: (channel: RTCDataChannel) => void;
  onState?: (state: TvRemotePeerState) => void;
  onError?: (error: unknown) => void;
  createPeer?: () => RTCPeerConnection;
};

function serializableCandidate(candidate: RTCIceCandidate): Extract<TvRemoteSignal, { type: 'ice-candidate' }>['candidate'] {
  const value = candidate.toJSON();
  return {
    candidate: value.candidate ?? '',
    sdpMid: value.sdpMid ?? null,
    sdpMLineIndex: value.sdpMLineIndex ?? null,
    ...(value.usernameFragment === undefined ? {} : { usernameFragment: value.usernameFragment })
  };
}

export function supportsTvRemotePeer() {
  return typeof RTCPeerConnection !== 'undefined';
}

export function createTvRemotePeerController(options: PeerOptions): TvRemotePeerController {
  if (!options.createPeer && !supportsTvRemotePeer()) {
    options.onState?.('unsupported');
    return {
      start: async () => undefined,
      handleSignal: async () => undefined,
      close: () => undefined
    };
  }

  const peer = options.createPeer?.() ?? new RTCPeerConnection();
  const pendingCandidates: RTCIceCandidateInit[] = [];
  let started = false;
  let closed = false;
  let channel: RTCDataChannel | null = null;
  let removeChannelListeners: (() => void) | null = null;
  let lastState: TvRemotePeerState | null = null;

  const emitState = (state: TvRemotePeerState) => {
    if (lastState === state) return;
    lastState = state;
    options.onState?.(state);
  };

  const detachChannel = (shouldClose: boolean) => {
    const current = channel;
    removeChannelListeners?.();
    removeChannelListeners = null;
    channel = null;
    if (shouldClose && current && current.readyState !== 'closed') current.close();
  };

  const cleanup = () => {
    if (closed) return false;
    closed = true;
    pendingCandidates.length = 0;
    detachChannel(true);
    peer.removeEventListener('icecandidate', onIceCandidate);
    peer.removeEventListener('connectionstatechange', onConnectionStateChange);
    peer.removeEventListener('datachannel', onDataChannel);
    peer.close();
    return true;
  };

  const reportClosed = () => {
    if (!cleanup()) return;
    emitState('closed');
  };

  const reportError = (error: unknown) => {
    if (!cleanup()) return;
    emitState('error');
    options.onError?.(error);
  };

  const attachChannel = (next: RTCDataChannel) => {
    if (closed || next.label !== TV_REMOTE_MEDIA_CHANNEL) {
      if (next.label !== TV_REMOTE_MEDIA_CHANNEL) next.close();
      return;
    }
    if (channel && channel !== next) detachChannel(true);
    channel = next;
    next.binaryType = 'arraybuffer';

    const onOpen = () => {
      if (!closed && channel === next) emitState('open');
    };
    const onClose = () => {
      if (!closed && channel === next) reportClosed();
    };
    const onError = () => {
      if (!closed && channel === next) reportError(new Error('Canal P2P com a TV ficou indisponível.'));
    };

    next.addEventListener('open', onOpen);
    next.addEventListener('close', onClose);
    next.addEventListener('error', onError);
    removeChannelListeners = () => {
      next.removeEventListener('open', onOpen);
      next.removeEventListener('close', onClose);
      next.removeEventListener('error', onError);
    };

    if (next.readyState === 'open') onOpen();
    options.onChannel(next);
  };

  function onIceCandidate(event: RTCPeerConnectionIceEvent) {
    if (closed || !event.candidate) return;
    void options.sendSignal({
      from: options.role,
      type: 'ice-candidate',
      candidate: serializableCandidate(event.candidate)
    }).catch(reportError);
  }

  function onConnectionStateChange() {
    if (closed) return;
    if (peer.connectionState === 'failed') {
      reportError(new Error('Falha na conexão P2P com a TV.'));
      return;
    }
    if (peer.connectionState === 'closed') {
      reportClosed();
      return;
    }
    if (peer.connectionState === 'disconnected') {
      emitState('connecting');
      return;
    }
    if (peer.connectionState === 'connected') {
      emitState(channel?.readyState === 'open' ? 'open' : 'connecting');
    }
  }

  function onDataChannel(event: RTCDataChannelEvent) {
    attachChannel(event.channel);
  }

  peer.addEventListener('icecandidate', onIceCandidate);
  peer.addEventListener('connectionstatechange', onConnectionStateChange);
  peer.addEventListener('datachannel', onDataChannel);

  const publishLocalDescription = async () => {
    const description = peer.localDescription;
    if (!description?.sdp || (description.type !== 'offer' && description.type !== 'answer')) {
      throw new Error('Descrição WebRTC local inválida.');
    }
    await options.sendSignal({
      from: options.role,
      type: 'description',
      description: { type: description.type, sdp: description.sdp }
    });
  };

  const flushCandidates = async () => {
    if (!peer.remoteDescription) return;
    while (pendingCandidates.length > 0) {
      const candidate = pendingCandidates.shift();
      if (candidate) await peer.addIceCandidate(candidate);
    }
  };

  return {
    start: async () => {
      if (closed || started || options.role !== 'remote') return;
      started = true;
      emitState('connecting');
      try {
        attachChannel(peer.createDataChannel(TV_REMOTE_MEDIA_CHANNEL, { ordered: true }));
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await publishLocalDescription();
      } catch (error) {
        reportError(error);
        throw error;
      }
    },
    handleSignal: async signal => {
      if (closed || signal.from === options.role) return;
      try {
        if (signal.type === 'ice-candidate') {
          const candidate: RTCIceCandidateInit = signal.candidate;
          if (!peer.remoteDescription) pendingCandidates.push(candidate);
          else await peer.addIceCandidate(candidate);
          return;
        }

        if (options.role === 'tv' && signal.description.type === 'offer') {
          emitState('connecting');
          await peer.setRemoteDescription(signal.description);
          await flushCandidates();
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          await publishLocalDescription();
          return;
        }
        if (options.role === 'remote' && signal.description.type === 'answer') {
          await peer.setRemoteDescription(signal.description);
          await flushCandidates();
        }
      } catch (error) {
        reportError(error);
        throw error;
      }
    },
    close: () => {
      cleanup();
    }
  };
}
