import type { CSSProperties, ReactNode } from 'react';
import { useAutoHideControls } from '../useAutoHideControls';

const MOBILE_CHROME_HIDE_DELAY_MS = 1800;

type PlayerMobileChromeProps = {
  playing: boolean;
  trackId: string;
  style?: CSSProperties;
  hasArtwork: boolean;
  children: ReactNode;
};

export function PlayerMobileChrome({
  playing,
  trackId,
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
      data-mobile-chrome-visible={chrome.visible ? 'true' : 'false'}
      onPointerDownCapture={chrome.onPointerDownCapture}
      onFocusCapture={chrome.onFocusCapture}
      onBlurCapture={chrome.onBlurCapture}
    >
      {children}
    </div>
  );
}
