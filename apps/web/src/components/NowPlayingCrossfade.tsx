import type { CSSProperties } from 'react';
import type { Track } from '@home-music/shared';
import type { CrossfadeVisualState } from '../crossfade-visual';
import { playerArtworkTrack } from '../player-presentation';
import { NowPlayingVinyl } from './NowPlayingVinyl';

type CrossfadeStyle = CSSProperties & {
  '--now-playing-crossfade-outgoing-opacity'?: string;
  '--now-playing-crossfade-incoming-opacity'?: string;
  '--now-playing-crossfade-incoming-scale'?: string;
  '--now-playing-crossfade-outgoing-y'?: string;
  '--now-playing-crossfade-incoming-y'?: string;
};

type CrossfadePresentationProps = {
  current: Track;
  crossfade: CrossfadeVisualState | null;
  transitionWindowSeconds?: number;
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

export function crossfadePresentationProgress(
  crossfade: CrossfadeVisualState | null,
  transitionWindowSeconds?: number
) {
  if (!crossfade) return null;

  const duration = Math.max(0.1, crossfade.durationSeconds);
  const elapsed = Math.max(0, Math.min(duration, crossfade.elapsedSeconds));
  if (transitionWindowSeconds === undefined) return elapsed / duration;

  const windowDuration = Math.max(0.1, Math.min(duration, transitionWindowSeconds));
  const windowStart = duration - windowDuration;
  return Math.max(0, Math.min(1, (elapsed - windowStart) / windowDuration));
}

function smoothstep(progress: number) {
  return progress * progress * (3 - (2 * progress));
}

function crossfadeStyle(
  progress: number | null,
  variant: 'art' | 'copy',
  polished: boolean
): CrossfadeStyle | undefined {
  if (progress === null) return undefined;

  if (!polished) {
    return {
      '--now-playing-crossfade-outgoing-opacity': String(1 - progress),
      '--now-playing-crossfade-incoming-opacity': String(progress),
      '--now-playing-crossfade-incoming-scale': String(0.92 + (progress * 0.08)),
      '--now-playing-crossfade-outgoing-y': `${-8 * progress}px`,
      '--now-playing-crossfade-incoming-y': `${8 * (1 - progress)}px`
    };
  }

  const eased = smoothstep(progress);
  if (variant === 'art') {
    return {
      '--now-playing-crossfade-outgoing-opacity': String(1 - eased),
      '--now-playing-crossfade-incoming-opacity': String(eased),
      '--now-playing-crossfade-incoming-scale': String(0.985 + (eased * 0.015)),
      '--now-playing-crossfade-outgoing-y': '0px',
      '--now-playing-crossfade-incoming-y': '0px'
    };
  }

  const outgoingProgress = smoothstep(Math.min(1, progress / 0.78));
  const incomingProgress = smoothstep(Math.max(0, Math.min(1, (progress - 0.18) / 0.82)));
  return {
    '--now-playing-crossfade-outgoing-opacity': String(1 - outgoingProgress),
    '--now-playing-crossfade-incoming-opacity': String(incomingProgress),
    '--now-playing-crossfade-incoming-scale': '1',
    '--now-playing-crossfade-outgoing-y': `${-8 * outgoingProgress}px`,
    '--now-playing-crossfade-incoming-y': `${8 * (1 - incomingProgress)}px`
  };
}

export function NowPlayingCrossfadeVinyl({
  current,
  crossfade,
  transitionWindowSeconds,
  playing,
  offlineMode = false
}: CrossfadeVinylProps) {
  const active = activeCrossfade(current, crossfade);
  const progress = crossfadePresentationProgress(active, transitionWindowSeconds);
  const polished = transitionWindowSeconds !== undefined;
  const style = crossfadeStyle(progress, 'art', polished);

  return (
    <div
      className={`now-playing-transition-art ${active ? 'is-crossfading' : ''} ${polished ? 'is-polished' : ''}`}
      style={style}
      data-crossfading={active ? 'true' : 'false'}
      data-crossfade-progress={progress === null ? undefined : progress.toFixed(3)}
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
  transitionWindowSeconds,
  titleId
}: CrossfadeIdentityProps) {
  const active = activeCrossfade(current, crossfade);
  const progress = crossfadePresentationProgress(active, transitionWindowSeconds);
  const polished = transitionWindowSeconds !== undefined;
  const style = crossfadeStyle(progress, 'copy', polished);

  return (
    <div
      className={`now-playing-transition-copy ${active ? 'is-crossfading' : ''} ${polished ? 'is-polished' : ''}`}
      style={style}
      data-crossfading={active ? 'true' : 'false'}
      data-crossfade-progress={progress === null ? undefined : progress.toFixed(3)}
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
