import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearTvRemoteMediaSources,
  filterTracksWithTvRemoteMediaSource,
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

  it('evicts the oldest transient source so long TV sessions stay memory bounded', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two')
      .mockReturnValueOnce('blob:three')
      .mockReturnValueOnce('blob:four');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    setTvRemoteMediaSource('track-1', new Blob(['one']));
    setTvRemoteMediaSource('track-2', new Blob(['two']));
    setTvRemoteMediaSource('track-3', new Blob(['three']));
    setTvRemoteMediaSource('track-4', new Blob(['four']));

    expect(getTvRemoteMediaSource('track-1')).toBeNull();
    expect(getTvRemoteMediaSource('track-2')).toBe('blob:two');
    expect(getTvRemoteMediaSource('track-4')).toBe('blob:four');
    expect(revoke).toHaveBeenCalledWith('blob:one');
  });

  it('filters receiver metadata to tracks that still have a playable transient source', () => {
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two')
      .mockReturnValueOnce('blob:three')
      .mockReturnValueOnce('blob:four');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    setTvRemoteMediaSource('track-1', new Blob(['one']));
    setTvRemoteMediaSource('track-2', new Blob(['two']));
    setTvRemoteMediaSource('track-3', new Blob(['three']));
    setTvRemoteMediaSource('track-4', new Blob(['four']));

    const tracks = [
      { id: 'track-1', title: 'One' },
      { id: 'track-2', title: 'Two' },
      { id: 'track-3', title: 'Three' },
      { id: 'track-4', title: 'Four' }
    ];

    expect(filterTracksWithTvRemoteMediaSource(tracks)).toEqual(tracks.slice(1));
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
