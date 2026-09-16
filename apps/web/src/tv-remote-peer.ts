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

  const reportError = (error: unknown) => {
    if (closed) return;
    options.onState?.('error');
    options.onError?.(error);
  };

  const attachChannel = (next: RTCDataChannel) => {
    if (closed || next.label !== TV_REMOTE_MEDIA_CHANNEL) {
      if (next.label !== TV_REMOTE_MEDIA_CHANNEL) next.close();
      return;
    }
    channel?.close();
    channel = next;
    next.binaryType = 'arraybuffer';
    const onOpen = () => {
      if (!closed) options.onState?.('open');
    };
    const onClose = () => {
      if (!closed) options.onState?.('closed');
    };
    next.addEventListener('open', onOpen);
    next.addEventListener('close', onClose);
    if (next.readyState === 'open') onOpen();
    options.onChannel(next);
  };

  peer.addEventListener('icecandidate', event => {
    if (closed || !event.candidate) return;
    void options.sendSignal({
      from: options.role,
      type: 'ice-candidate',
      candidate: serializableCandidate(event.candidate)
    }).catch(reportError);
  });

  peer.addEventListener('connectionstatechange', () => {
    if (closed) return;
    if (peer.connectionState === 'failed') reportError(new Error('Falha na conexão P2P com a TV.'));
    else if (peer.connectionState === 'closed') options.onState?.('closed');
  });

  peer.addEventListener('datachannel', event => attachChannel(event.channel));

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
      options.onState?.('connecting');
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
          options.onState?.('connecting');
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
      if (closed) return;
      closed = true;
      pendingCandidates.length = 0;
      channel?.close();
      channel = null;
      peer.close();
      options.onState?.('closed');
    }
  };
}
