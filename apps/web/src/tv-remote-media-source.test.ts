import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTvRemoteMediaSources,
  getTvRemoteMediaSource,
  setTvRemoteMediaSource
} from './tv-remote-media-source';

afterEach(() => {
  clearTvRemoteMediaSources();
  vi.restoreAllMocks();
});

describe('TV remote transient media sources', () => {
  it('replaces and revokes object URLs per track', () => {
    const create = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    expect(setTvRemoteMediaSource('track-1', new Blob(['one'], { type: 'audio/mpeg' }))).toBe('blob:first');
    expect(getTvRemoteMediaSource('track-1')).toBe('blob:first');
    expect(setTvRemoteMediaSource('track-1', new Blob(['two'], { type: 'audio/mpeg' }))).toBe('blob:second');

    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith('blob:first');
    expect(getTvRemoteMediaSource('track-1')).toBe('blob:second');
  });

  it('clears every transient source', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    setTvRemoteMediaSource('track-1', new Blob(['one']));
    setTvRemoteMediaSource('track-2', new Blob(['two']));

    clearTvRemoteMediaSources();

    expect(revoke).toHaveBeenCalledWith('blob:one');
    expect(revoke).toHaveBeenCalledWith('blob:two');
    expect(getTvRemoteMediaSource('track-1')).toBeNull();
    expect(getTvRemoteMediaSource('track-2')).toBeNull();
  });
});
