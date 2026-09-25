import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

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
  const [visible, setVisible] = useState(true);
  const hideTimeoutRef = useRef<number | null>(null);

  function clearHideTimeout() {
    if (hideTimeoutRef.current == null) return;
    window.clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = null;
  }

  function reveal() {
    clearHideTimeout();
    setVisible(true);
    if (playing) {
      hideTimeoutRef.current = window.setTimeout(() => setVisible(false), MOBILE_CHROME_HIDE_DELAY_MS);
    }
  }

  useEffect(() => {
    reveal();
    return clearHideTimeout;
  }, [playing, trackId]);

  return (
    <div
      className="player-screen-immersive"
      style={style}
      data-has-artwork={hasArtwork ? 'true' : 'false'}
      data-mobile-chrome-visible={visible ? 'true' : 'false'}
      onPointerDownCapture={reveal}
      onFocusCapture={reveal}
    >
      {children}
    </div>
  );
}
