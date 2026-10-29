import type { CSSProperties, ReactNode } from 'react';
import { useAutoHideControls } from '../useAutoHideControls';
import type { TrackChangeMotionKind } from '../use-track-change-motion';

const MOBILE_CHROME_HIDE_DELAY_MS = 1800;

type PlayerMobileChromeProps = {
  playing: boolean;
  trackId: string;
  motion?: TrackChangeMotionKind;
  style?: CSSProperties;
  hasArtwork: boolean;
  children: ReactNode;
};

export function PlayerMobileChrome({
  playing,
  trackId,
  motion = 'init',
  style,
  hasArtwork,
  children
}: PlayerMobileChromeProps) {
  const chrome = useAutoHideControls<HTMLDivElement>(playing, trackId, MOBILE_CHROME_HIDE_DELAY_MS);

  return (
    <div
      ref={chrome.rootRef}
      className="player-screen-immersive"
      style={style}
      data-has-artwork={hasArtwork ? 'true' : 'false'}
      data-motion={motion}
      data-mobile-chrome-visible={chrome.visible ? 'true' : 'false'}
      onPointerDownCapture={chrome.onPointerDownCapture}
      onFocusCapture={chrome.onFocusCapture}
      onBlurCapture={chrome.onBlurCapture}
    >
      {children}
    </div>
  );
}
