import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent
} from 'react';

export function shouldScheduleAutoHide(playing: boolean, focusWithin: boolean) {
  return playing && !focusWithin;
}

export function useAutoHideControls<T extends HTMLElement>(
  playing: boolean,
  resetKey: string,
  delayMs = 1800
) {
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<T | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current == null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const scheduleHide = useCallback(() => {
    clear();
    const root = rootRef.current;
    const focusWithin = Boolean(root?.contains(document.activeElement));
    if (!shouldScheduleAutoHide(playing, focusWithin)) return;
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

  const onBlurCapture = useCallback((event: FocusEvent<T>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    scheduleHide();
  }, [scheduleHide]);

  const onPointerDownCapture = useCallback((_event: PointerEvent<T>) => {
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
