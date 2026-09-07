import type { Track } from '@home-music/shared';
import { Artwork } from './Artwork';

type NowPlayingVinylProps = {
  track: Track;
  playing: boolean;
  className?: string;
};

export function NowPlayingVinyl({ track, playing, className }: NowPlayingVinylProps) {
  const classes = [
    'now-playing-vinyl',
    playing ? 'is-playing' : '',
    className ?? ''
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-playing={playing ? 'true' : 'false'}
      aria-hidden="true"
    >
      <div className="now-playing-vinyl__disc">
        <div className="now-playing-vinyl__label">
          <Artwork track={track} />
        </div>
        <span className="now-playing-vinyl__spindle" />
      </div>
    </div>
  );
}
