import type { Track } from '@home-music/shared';
import { Artwork } from './Artwork';

type NowPlayingVinylProps = {
  track: Track;
  playing: boolean;
  className?: string;
  incomingTrack?: Track;
  crossfadeAttempt?: number;
};

export function NowPlayingVinyl({
  track,
  playing,
  className,
  incomingTrack,
  crossfadeAttempt
}: NowPlayingVinylProps) {
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
        <div className={`now-playing-vinyl__label now-playing-vinyl__label--outgoing ${incomingTrack ? 'is-crossfading' : ''}`}>
          <Artwork track={track} />
        </div>
        {incomingTrack && (
          <div
            key={`${crossfadeAttempt ?? 0}:${incomingTrack.id}`}
            className="now-playing-vinyl__label now-playing-vinyl__label--incoming"
          >
            <Artwork track={incomingTrack} />
          </div>
        )}
        <span className="now-playing-vinyl__spindle" />
      </div>
    </div>
  );
}
