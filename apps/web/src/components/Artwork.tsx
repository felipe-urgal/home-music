import { Music2 } from 'lucide-react';
import type { Track } from '@home-music/shared';

export function Artwork({ track, large = false }: { track?: Track; large?: boolean }) {
  const url = track?.hasCover ? `/api/tracks/${track.id}/cover` : null;

  return (
    <div className={large ? 'artwork artwork--large' : 'artwork'}>
      {url ? <img src={url} alt="" loading={large ? 'eager' : 'lazy'} /> : <Music2 aria-hidden="true" />}
    </div>
  );
}
