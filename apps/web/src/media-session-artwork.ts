import type { Track } from '@home-music/shared';
import { artworkFallbackDataUrl, buildArtworkFallback } from './artwork-utils';

export type MediaSessionArtworkResource = {
  src: string;
  sizes?: string;
  type?: string;
};

type MediaSessionArtworkOptions = {
  offlineMode?: boolean;
  fallbackSize?: number;
};

type MediaSessionMetadataTarget = {
  metadata: MediaMetadata | null;
};

type MediaMetadataFactory = (init: MediaMetadataInit) => MediaMetadata;

export type MediaSessionMetadataPublishResult = 'artwork' | 'text-only' | 'unsupported' | 'failed';

export function canonicalCoverUrl(track: Track) {
  const version = track.coverVersion
    ? `?v=${encodeURIComponent(track.coverVersion)}`
    : '';
  return `/api/tracks/${encodeURIComponent(track.id)}/cover${version}`;
}

export function resolveMediaSessionArtwork(
  track: Track,
  options: MediaSessionArtworkOptions = {}
): MediaSessionArtworkResource[] {
  if (!options.offlineMode && track.hasCover) {
    return [{ src: canonicalCoverUrl(track) }];
  }

  const size = Math.max(64, Math.min(1024, Math.round(options.fallbackSize ?? 512)));
  const identity = buildArtworkFallback(track);
  return [{
    src: artworkFallbackDataUrl(identity, size),
    sizes: `${size}x${size}`,
    type: 'image/svg+xml'
  }];
}

export function publishMediaSessionMetadata(
  target: MediaSessionMetadataTarget | null | undefined,
  track: Track,
  options: MediaSessionArtworkOptions = {},
  createMetadata?: MediaMetadataFactory
): MediaSessionMetadataPublishResult {
  if (!target) return 'unsupported';

  const factory = createMetadata ?? (
    typeof MediaMetadata === 'undefined'
      ? null
      : (init: MediaMetadataInit) => new MediaMetadata(init)
  );
  if (!factory) return 'unsupported';

  const base: MediaMetadataInit = {
    title: track.title,
    artist: track.artist,
    album: track.album
  };

  try {
    target.metadata = factory({
      ...base,
      artwork: resolveMediaSessionArtwork(track, options)
    });
    return 'artwork';
  } catch {
    try {
      target.metadata = factory(base);
      return 'text-only';
    } catch {
      return 'failed';
    }
  }
}
