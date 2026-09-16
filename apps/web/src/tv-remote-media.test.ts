import { describe, expect, it } from 'vitest';
import {
  createTvRemoteMediaEndpoint,
  parseTvRemoteMediaControl,
  TV_REMOTE_MEDIA_CHUNK_BYTES,
  TV_REMOTE_MEDIA_MAX_BYTES
} from './tv-remote-media';

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

describe('tv remote media protocol', () => {
  it('accepts only bounded audio transfer controls', () => {
    expect(parseTvRemoteMediaControl({
      type: 'media-start', transferId: 't1', trackId: 'track-1', mimeType: 'audio/mpeg', size: 123
    })).toEqual({
      type: 'media-start', transferId: 't1', trackId: 'track-1', mimeType: 'audio/mpeg', size: 123
    });
    expect(parseTvRemoteMediaControl({
      type: 'media-start', transferId: 't1', trackId: 'track-1', mimeType: 'video/mp4', size: 123
    })).toBeNull();
    expect(parseTvRemoteMediaControl({
      type: 'media-start', transferId: 't1', trackId: 'track-1', mimeType: 'audio/mpeg', size: TV_REMOTE_MEDIA_MAX_BYTES + 1
    })).toBeNull();
    expect(parseTvRemoteMediaControl({ type: 'media-complete', transferId: '', extra: true })).toBeNull();
  });

  it('transfers a blob in chunks and resolves only after receiver confirmation', async () => {
    const [senderChannel, receiverChannel] = pair();
    const received: Array<{ trackId: string; text: string; size: number }> = [];
    const progress: number[] = [];
    const receiver = createTvRemoteMediaEndpoint(receiverChannel as unknown as RTCDataChannel, {
      onReceive: async media => {
        received.push({ trackId: media.trackId, text: await media.blob.text(), size: media.size });
      }
    });
    const sender = createTvRemoteMediaEndpoint(senderChannel as unknown as RTCDataChannel, {
      createTransferId: () => 'transfer-1'
    });
    const payload = 'x'.repeat(TV_REMOTE_MEDIA_CHUNK_BYTES + 17);
    const blob = new Blob([payload], { type: 'audio/mpeg' });

    await sender.send({ trackId: 'track-1', blob }, sent => progress.push(sent));

    expect(received).toEqual([{ trackId: 'track-1', text: payload, size: blob.size }]);
    expect(progress).toEqual([TV_REMOTE_MEDIA_CHUNK_BYTES, blob.size]);
    sender.close();
    receiver.close();
  });

  it('rejects oversized local media before writing to the channel', async () => {
    const [senderChannel] = pair();
    const sender = createTvRemoteMediaEndpoint(senderChannel as unknown as RTCDataChannel, {
      createTransferId: () => 'transfer-1'
    });
    const fakeBlob = { size: TV_REMOTE_MEDIA_MAX_BYTES + 1, type: 'audio/mpeg' } as Blob;

    await expect(sender.send({ trackId: 'track-1', blob: fakeBlob })).rejects.toThrow('limite de transmissão');
    sender.close();
  });
});
