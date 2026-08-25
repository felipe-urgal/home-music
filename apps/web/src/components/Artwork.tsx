import { useEffect, useState } from 'react';
import { Music2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { buildArtworkFallback } from '../artwork-utils';

export function Artwork({ track, large = false }: { track?: Track; large?: boolean }) {
  const url = track?.hasCover ? `/api/tracks/${track.id}/cover` : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [url]);

  const showImage = Boolean(url && failedUrl !== url);
  const fallback = track ? buildArtworkFallback(track) : null;
  const className = [
    'artwork',
    large ? 'artwork--large' : '',
    showImage ? '' : 'artwork--fallback',
    !showImage && fallback ? `artwork--tone-${fallback.tone}` : ''
  ].filter(Boolean).join(' ');

  return (
    <div className={className} aria-hidden="true">
      {showImage && url ? (
        <img
          src={url}
          alt=""
          loading={large ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(url)}
        />
      ) : fallback ? (
        <span className="artwork-fallback">
          <span className="artwork-fallback__label">{fallback.label}</span>
          <span className="artwork-fallback__disc" />
        </span>
      ) : (
        <Music2 />
      )}
    </div>
  );
}
