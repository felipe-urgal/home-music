import { describe, expect, it, vi } from 'vitest';
import type { TvRemoteCommand, TvRemotePlaybackSnapshot } from '@home-music/shared/tv-remote';
import {
  createTvRemoteDataChannel,
  parseTvRemoteDataFrame,
  TV_REMOTE_DATA_VERSION
} from './tv-remote-data-channel';

class FakeDataChannel extends EventTarget {
  readonly label = 'home-music-media-v1';
  readyState: RTCDataChannelState = 'open';
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  partner: FakeDataChannel | null = null;

  send(data: string | Blob | ArrayBuffer | ArrayBufferView) {
    const partner = this.partner;
    if (!partner) throw new Error('missing partner');
    queueMicrotask(() => {
      const event = new Event('message') as MessageEvent;
      Object.defineProperty(event, 'data', { value: data });
      partner.dispatchEvent(event);
    });
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}

function pair() {
  const left = new FakeDataChannel();
  const right = new FakeDataChannel();
  left.partner = right;
  right.partner = left;
  return [left, right] as const;
}

const testSetTimeout = ((handler: () => void, timeout?: number) =>
  globalThis.setTimeout(handler, timeout) as unknown as number) as typeof window.setTimeout;
const testClearTimeout = ((handle?: number) =>
  globalThis.clearTimeout(handle)) as typeof window.clearTimeout;
const timerOptions = { setTimeout: testSetTimeout, clearTimeout: testClearTimeout };

const snapshot: TvRemotePlaybackSnapshot = {
  trackId: 'track-1', title: 'Track', artist: 'Artist', playing: true,
  currentTime: 2, duration: 120, updatedAt: '2026-09-16T12:00:00.000Z',
  shuffle: false, repeatMode: 'off'
};

describe('TV remote DataChannel protocol', () => {
  it('accepts only versioned bounded command and snapshot frames', () => {
    expect(parseTvRemoteDataFrame({
      version: TV_REMOTE_DATA_VERSION,
      id: 'message_1234567890',
      kind: 'command',
      payload: { type: 'toggle-play' }
    })?.kind).toBe('command');
    expect(parseTvRemoteDataFrame({
      version: TV_REMOTE_DATA_VERSION,
      id: 'message_seek_to_123',
      kind: 'command',
      payload: { type: 'seek-to', seconds: 42.5 }
    })?.kind).toBe('command');
    expect(parseTvRemoteDataFrame({
      version: TV_REMOTE_DATA_VERSION,
      id: 'message_seek_to_bad',
      kind: 'command',
      payload: { type: 'seek-to', seconds: -1 }
    })).toBeNull();
    expect(parseTvRemoteDataFrame({
      version: 'old', id: 'message_1234567890', kind: 'command', payload: { type: 'toggle-play' }
    })).toBeNull();
    expect(parseTvRemoteDataFrame({
      version: TV_REMOTE_DATA_VERSION,
      id: 'message_1234567890',
      kind: 'command',
      payload: { type: 'seek', deltaSeconds: 999 }
    })).toBeNull();
    expect(parseTvRemoteDataFrame({
      version: TV_REMOTE_DATA_VERSION,
      id: 'message_1234567890',
      kind: 'snapshot',
      payload: { ...snapshot, currentTime: Number.NaN }
    })).toBeNull();
  });

  it('delivers commands and snapshots once when a frame is replayed', async () => {
    const [remoteChannel, tvChannel] = pair();
    const commands: TvRemoteCommand[] = [];
    const snapshots: TvRemotePlaybackSnapshot[] = [];
    const tv = createTvRemoteDataChannel(tvChannel as unknown as RTCDataChannel, {
      ...timerOptions,
      onCommand: command => commands.push(command),
      createMessageId: () => 'tv_message_123456'
    });
    const remote = createTvRemoteDataChannel(remoteChannel as unknown as RTCDataChannel, {
      ...timerOptions,
      onSnapshot: value => snapshots.push(value),
      createMessageId: () => 'remote_message_123'
    });

    remote.sendCommand({ type: 'toggle-play' });
    tv.sendSnapshot(snapshot);
    remoteChannel.send(JSON.stringify({
      version: TV_REMOTE_DATA_VERSION,
      id: 'duplicate_message_1',
      kind: 'command',
      payload: { type: 'next' }
    }));
    remoteChannel.send(JSON.stringify({
      version: TV_REMOTE_DATA_VERSION,
      id: 'duplicate_message_1',
      kind: 'command',
      payload: { type: 'next' }
    }));
    await vi.waitFor(() => expect(commands).toHaveLength(2));
    expect(commands).toEqual([{ type: 'toggle-play' }, { type: 'next' }]);
    expect(snapshots).toEqual([snapshot]);

    remote.close();
    tv.close();
  });

  it('waits for media-ready before sending play-track', async () => {
    const [remoteChannel, tvChannel] = pair();
    const order: string[] = [];
    const tv = createTvRemoteDataChannel(tvChannel as unknown as RTCDataChannel, {
      ...timerOptions,
      onMedia: media => { order.push(`ready:${media.trackId}`); },
      onCommand: command => order.push(`command:${command.type}`),
      createMessageId: () => 'tv_message_123456'
    });
    const remote = createTvRemoteDataChannel(remoteChannel as unknown as RTCDataChannel, {
      ...timerOptions,
      createTransferId: () => 'transfer-1',
      createMessageId: () => 'remote_message_123'
    });

    await remote.sendTrackAndPlay({
      trackId: 'track-1',
      blob: new Blob(['audio'], { type: 'audio/mpeg' })
    });

    expect(order).toEqual(['ready:track-1', 'command:play-track']);
    remote.close();
    tv.close();
  });

  it('rejects commands and media after the underlying channel closes', async () => {
    const [remoteChannel] = pair();
    const remote = createTvRemoteDataChannel(remoteChannel as unknown as RTCDataChannel, {
      ...timerOptions,
      createTransferId: () => 'transfer-closed',
      createMessageId: () => 'remote_message_closed'
    });

    remoteChannel.close();

    expect(() => remote.sendCommand({ type: 'toggle-play' })).toThrow(/encerrada/);
    await expect(remote.sendTrackAndPlay({
      trackId: 'track-1',
      blob: new Blob(['audio'], { type: 'audio/mpeg' })
    })).rejects.toThrow(/P2P/);

    remote.close();
  });
});
