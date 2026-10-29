import { useEffect, useState } from 'react';
import type { Track } from '@home-music/shared';
import { DEFAULT_ARTWORK_ACCENT, loadArtworkAccent } from './artwork-accent';

export function trackCoverUrl(track?: Track) {
  if (!track?.hasCover) return null;
  const version = track.coverVersion ? `?v=${encodeURIComponent(track.coverVersion)}` : '';
  return `/api/tracks/${encodeURIComponent(track.id)}/cover${version}`;
}

export function useTrackArtworkAccent(track?: Track) {
  const coverUrl = trackCoverUrl(track);
  const [accent, setAccent] = useState(DEFAULT_ARTWORK_ACCENT);

  useEffect(() => {
    let cancelled = false;
    setAccent(DEFAULT_ARTWORK_ACCENT);
    if (!coverUrl) return () => {
      cancelled = true;
    };

    void loadArtworkAccent(coverUrl).then(nextAccent => {
      if (!cancelled && nextAccent) setAccent(nextAccent);
    });

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return accent;
}
