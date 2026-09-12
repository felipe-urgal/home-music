import type { CSSProperties } from 'react';
import type { Track } from '@home-music/shared';
import type { CrossfadeVisualState } from '../crossfade-visual';
import { playerArtworkTrack } from '../player-presentation';
import { NowPlayingVinyl } from './NowPlayingVinyl';

type CrossfadeStyle = CSSProperties & {
  '--now-playing-crossfade-duration'?: string;
  '--now-playing-crossfade-delay'?: string;
};

type CrossfadePresentationProps = {
  current: Track;
  crossfade: CrossfadeVisualState | null;
};

type CrossfadeVinylProps = CrossfadePresentationProps & {
  playing: boolean;
  offlineMode?: boolean;
};

type CrossfadeIdentityProps = CrossfadePresentationProps & {
  titleId?: string;
};

function activeCrossfade(current: Track, crossfade: CrossfadeVisualState | null) {
  return crossfade?.originTrackId === current.id ? crossfade : null;
}

function crossfadeStyle(crossfade: CrossfadeVisualState | null): CrossfadeStyle | undefined {
  if (!crossfade) return undefined;
  const duration = Math.max(0.1, crossfade.durationSeconds);
  const elapsed = Math.max(0, Math.min(duration, crossfade.elapsedSeconds));
  return {
    '--now-playing-crossfade-duration': `${duration}s`,
    '--now-playing-crossfade-delay': `${-elapsed}s`
  };
}

export function NowPlayingCrossfadeVinyl({
  current,
  crossfade,
  playing,
  offlineMode = false
}: CrossfadeVinylProps) {
  const active = activeCrossfade(current, crossfade);
  const style = crossfadeStyle(active);

  return (
    <div
      className={`now-playing-transition-art ${active ? 'is-crossfading' : ''}`}
      style={style}
      data-crossfading={active ? 'true' : 'false'}
      data-crossfade-incoming-title={active?.incomingTrack.title}
    >
      <NowPlayingVinyl
        track={playerArtworkTrack(current, offlineMode)}
        playing={playing}
        incomingTrack={active ? playerArtworkTrack(active.incomingTrack, offlineMode) : undefined}
        crossfadeAttempt={active?.attempt}
      />
    </div>
  );
}

export function NowPlayingCrossfadeIdentity({
  current,
  crossfade,
  titleId
}: CrossfadeIdentityProps) {
  const active = activeCrossfade(current, crossfade);
  const style = crossfadeStyle(active);

  return (
    <div
      className={`now-playing-transition-copy ${active ? 'is-crossfading' : ''}`}
      style={style}
      data-crossfading={active ? 'true' : 'false'}
      data-crossfade-incoming-title={active?.incomingTrack.title}
    >
      <div className={`now-playing-transition-copy__layer now-playing-transition-copy__layer--outgoing ${active ? 'is-crossfading' : ''}`}>
        <h1 id={titleId}>{current.title}</h1>
        <p>{current.artist || 'Artista desconhecido'}</p>
      </div>
      {active && (
        <div
          key={`${active.attempt}:${active.incomingTrack.id}`}
          className="now-playing-transition-copy__layer now-playing-transition-copy__layer--incoming"
          aria-hidden="true"
        >
          <h1>{active.incomingTrack.title}</h1>
          <p>{active.incomingTrack.artist || 'Artista desconhecido'}</p>
        </div>
      )}
    </div>
  );
}
