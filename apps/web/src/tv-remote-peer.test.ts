import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TvRemoteSignal } from '@home-music/shared/tv-remote';
import { createTvRemotePeerController, TV_REMOTE_MEDIA_CHANNEL } from './tv-remote-peer';

class FakeChannel extends EventTarget {
  label = TV_REMOTE_MEDIA_CHANNEL;
  readyState: RTCDataChannelState = 'connecting';
  binaryType: BinaryType = 'blob';
  close = vi.fn(() => {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  });

  open() {
    if (this.readyState === 'open') return;
    this.readyState = 'open';
    this.dispatchEvent(new Event('open'));
  }
}

class FakePeer extends EventTarget {
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  connectionState: RTCPeerConnectionState = 'new';
  channel = new FakeChannel();
  channels = [this.channel];
  candidates: RTCIceCandidateInit[] = [];
  private dataChannelCreations = 0;

  createDataChannel = vi.fn(() => {
    if (this.dataChannelCreations === 0) {
      this.dataChannelCreations += 1;
      return this.channel as unknown as RTCDataChannel;
    }
    this.dataChannelCreations += 1;
    const next = new FakeChannel();
    this.channels.push(next);
    return next as unknown as RTCDataChannel;
  });
  createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' }) as RTCSessionDescriptionInit);
  createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' }) as RTCSessionDescriptionInit);
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description as RTCSessionDescription;
  });
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description as RTCSessionDescription;
  });
  addIceCandidate = vi.fn(async (candidate: RTCIceCandidateInit) => { this.candidates.push(candidate); });
  close = vi.fn(() => { this.connectionState = 'closed'; });

  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.dispatchEvent(new Event('connectionstatechange'));
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('tv remote peer controller', () => {
  it('remote creates the media channel and publishes an offer', async () => {
    const peer = new FakePeer();
    const signals: TvRemoteSignal[] = [];
    const channels: RTCDataChannel[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async signal => { signals.push(signal); },
      onChannel: channel => channels.push(channel)
    });

    await controller.start();

    expect(peer.createDataChannel).toHaveBeenCalledWith(TV_REMOTE_MEDIA_CHANNEL, { ordered: true });
    expect(channels).toHaveLength(1);
    expect(signals).toEqual([{
      from: 'remote', type: 'description', description: { type: 'offer', sdp: 'offer-sdp' }
    }]);
    controller.close();
  });

  it('TV answers an offer and flushes ICE candidates that arrived before the description', async () => {
    const peer = new FakePeer();
    const signals: TvRemoteSignal[] = [];
    const controller = createTvRemotePeerController({
      role: 'tv',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async signal => { signals.push(signal); },
      onChannel: () => undefined
    });
    const candidate: TvRemoteSignal = {
      from: 'remote',
      type: 'ice-candidate',
      candidate: { candidate: 'candidate:1', sdpMid: '0', sdpMLineIndex: 0 }
    };

    await controller.handleSignal(candidate);
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
    await controller.handleSignal({
      from: 'remote', type: 'description', description: { type: 'offer', sdp: 'offer-sdp' }
    });

    expect(peer.setRemoteDescription).toHaveBeenCalled();
    expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate.candidate);
    expect(signals).toEqual([{
      from: 'tv', type: 'description', description: { type: 'answer', sdp: 'answer-sdp' }
    }]);
    controller.close();
  });

  it('does not report an unexpected closure when the controller is closed explicitly', async () => {
    const peer = new FakePeer();
    const states: string[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async () => undefined,
      onChannel: () => undefined,
      onState: state => states.push(state)
    });

    await controller.start();
    controller.close();

    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting']);
  });

  it('tears down the peer and reports closed once when the media channel closes unexpectedly', async () => {
    const peer = new FakePeer();
    const states: string[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async () => undefined,
      onChannel: () => undefined,
      onState: state => states.push(state)
    });

    await controller.start();
    peer.channel.open();
    peer.channel.close();
    peer.setConnectionState('closed');

    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'open', 'closed']);
  });

  it('leaves open state during a transient disconnect and restores it when the peer reconnects', async () => {
    const peer = new FakePeer();
    const states: string[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async () => undefined,
      onChannel: () => undefined,
      onState: state => states.push(state)
    });

    await controller.start();
    peer.channel.open();
    peer.setConnectionState('disconnected');

    expect(states).toEqual(['connecting', 'open', 'connecting']);
    expect(peer.close).not.toHaveBeenCalled();

    peer.setConnectionState('connected');

    expect(states).toEqual(['connecting', 'open', 'connecting', 'open']);
    expect(peer.close).not.toHaveBeenCalled();
    controller.close();
  });

  it('recreates the data channel without a new QR when the mobile browser resumes', async () => {
    const peer = new FakePeer();
    const states: string[] = [];
    const channels: RTCDataChannel[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async () => undefined,
      onChannel: channel => channels.push(channel),
      onState: state => states.push(state)
    });

    await controller.start();
    peer.setConnectionState('connected');
    peer.channel.open();
    expect(states).toEqual(['connecting', 'open']);

    peer.channel.close();
    await vi.waitFor(() => expect(peer.createDataChannel).toHaveBeenCalledTimes(2));
    expect(peer.close).not.toHaveBeenCalled();
    expect(states).toEqual(['connecting', 'open', 'connecting']);
    expect(channels).toHaveLength(2);

    const replacement = peer.channels[1];
    expect(replacement).toBeDefined();
    replacement!.open();

    expect(states).toEqual(['connecting', 'open', 'connecting', 'open']);
    expect(peer.close).not.toHaveBeenCalled();
    controller.close();
  });

  it('tears down and reports an error when a transient disconnect becomes a failed peer', async () => {
    const peer = new FakePeer();
    const states: string[] = [];
    const errors: Error[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async () => undefined,
      onChannel: () => undefined,
      onState: state => states.push(state),
      onError: error => errors.push(error as Error)
    });

    await controller.start();
    peer.channel.open();
    peer.setConnectionState('disconnected');

    expect(peer.close).not.toHaveBeenCalled();

    peer.setConnectionState('failed');

    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['connecting', 'open', 'connecting', 'error']);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('Falha na conexão P2P com a TV.');
  });

  it('keeps the peer alive through a prolonged disconnect and restores it when iOS resumes', async () => {
    vi.useFakeTimers();
    const peer = new FakePeer();
    const states: string[] = [];
    const errors: Error[] = [];
    const controller = createTvRemotePeerController({
      role: 'remote',
      createPeer: () => peer as unknown as RTCPeerConnection,
      sendSignal: async () => undefined,
      onChannel: () => undefined,
      onState: state => states.push(state),
      onError: error => errors.push(error as Error)
    });

    await controller.start();
    peer.channel.open();
    peer.setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(30_000);

    expect(peer.close).not.toHaveBeenCalled();
    expect(states).toEqual(['connecting', 'open', 'connecting']);
    expect(errors).toHaveLength(0);

    peer.setConnectionState('connected');

    expect(states).toEqual(['connecting', 'open', 'connecting', 'open']);
    expect(peer.close).not.toHaveBeenCalled();
    controller.close();
  });
});