import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent
} from 'react';

export function useAutoHideControls(
  playing: boolean,
  resetKey: string,
  delayMs = 1800
) {
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current == null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    clear();
    if (!playing) return;
    const root = rootRef.current;
    if (root?.contains(document.activeElement)) return;
    timeoutRef.current = window.setTimeout(() => setVisible(false), delayMs);
  }, [clear, delayMs, playing]);

  const reveal = useCallback(() => {
    clear();
    setVisible(true);
    scheduleHide();
  }, [clear, scheduleHide]);

  const onFocusCapture = useCallback(() => {
    clear();
    setVisible(true);
  }, [clear]);

  const onBlurCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    scheduleHide();
  }, [scheduleHide]);

  const onPointerDownCapture = useCallback((_event: PointerEvent<HTMLElement>) => {
    reveal();
  }, [reveal]);

  useEffect(() => {
    reveal();
    return clear;
  }, [clear, resetKey, reveal]);

  return {
    visible,
    rootRef,
    reveal,
    onFocusCapture,
    onBlurCapture,
    onPointerDownCapture
  };
}
