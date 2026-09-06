import { useEffect, useState, type CSSProperties } from 'react';
import { Music2 } from 'lucide-react';
import type { Track } from '@home-music/shared';
import { buildArtworkFallback } from '../artwork-utils';

type ArtworkProps = {
  track?: Track;
  large?: boolean;
};

type ArtworkFallbackStyle = CSSProperties & {
  '--artwork-fallback-glow'?: string;
  '--artwork-fallback-surface'?: string;
  '--artwork-fallback-base'?: string;
};

export function ArtworkFallback({ track, large = false }: ArtworkProps) {
  const fallback = track ? buildArtworkFallback(track) : null;
  const className = [
    'artwork',
    large ? 'artwork--large' : '',
    'artwork--fallback'
  ].filter(Boolean).join(' ');
  const style: ArtworkFallbackStyle | undefined = fallback ? {
    '--artwork-fallback-glow': fallback.palette.glow,
    '--artwork-fallback-surface': fallback.palette.surface,
    '--artwork-fallback-base': fallback.palette.base
  } : undefined;

  return (
    <div
      className={className}
      style={style}
      aria-hidden="true"
      data-artwork-state="fallback"
      data-artwork-fallback-version={fallback?.version}
      data-artwork-fallback-tone={fallback?.tone}
    >
      {fallback ? (
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

export function Artwork({ track, large = false }: ArtworkProps) {
  const version = track?.coverVersion ? `?v=${encodeURIComponent(track.coverVersion)}` : '';
  const url = track?.hasCover ? `/api/tracks/${encodeURIComponent(track.id)}/cover${version}` : null;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [url]);

  const showImage = Boolean(url && failedUrl !== url);

  if (!showImage || !url) {
    return <ArtworkFallback track={track} large={large} />;
  }

  return (
    <div className={`artwork${large ? ' artwork--large' : ''}`} aria-hidden="true" data-artwork-state="cover">
      <img
        src={url}
        alt=""
        loading={large ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
        onError={() => setFailedUrl(url)}
      />
    </div>
  );
}
