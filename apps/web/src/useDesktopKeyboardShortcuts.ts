import { useEffect, useRef } from 'react';

export const DESKTOP_SEEK_STEP_SECONDS = 5;
export const DESKTOP_VOLUME_STEP = 0.05;

export type DesktopShortcutAction =
  | 'toggle-play'
  | 'previous'
  | 'next'
  | 'seek-backward'
  | 'seek-forward'
  | 'volume-up'
  | 'volume-down'
  | 'focus-search';

type ShortcutKeyEvent = {
  key: string;
  code?: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  repeat?: boolean;
};

type DesktopKeyboardShortcutsOptions = {
  enabled: boolean;
  hasCurrent?: boolean;
  hasNext?: boolean;
  currentTime?: number;
  duration?: number;
  volume?: number;
  usesSystemVolume?: boolean;
  onTogglePlay?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSeek?: (value: number) => void;
  onVolume?: (value: number) => void;
  onFocusSearch?: () => void;
};

const INTERACTIVE_TARGET_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'a[href]',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="spinbutton"]'
].join(',');

export function resolveDesktopShortcut(event: ShortcutKeyEvent): DesktopShortcutAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;

  if (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar') {
    return event.repeat ? null : 'toggle-play';
  }

  if (event.key === '/') return event.repeat ? null : 'focus-search';

  if (event.key === 'ArrowLeft') {
    if (event.shiftKey) return event.repeat ? null : 'previous';
    return 'seek-backward';
  }

  if (event.key === 'ArrowRight') {
    if (event.shiftKey) return event.repeat ? null : 'next';
    return 'seek-forward';
  }

  if (event.key === 'ArrowUp') return 'volume-up';
  if (event.key === 'ArrowDown') return 'volume-down';
  return null;
}

export function isDesktopShortcutTargetInteractive(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_TARGET_SELECTOR));
}

export function useDesktopKeyboardShortcuts({
  enabled,
  hasCurrent = false,
  hasNext = false,
  currentTime = 0,
  duration = 0,
  volume = 1,
  usesSystemVolume = false,
  onTogglePlay,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onFocusSearch
}: DesktopKeyboardShortcutsOptions) {
  const stateRef = useRef({
    hasCurrent,
    hasNext,
    currentTime,
    duration,
    volume,
    usesSystemVolume,
    onTogglePlay,
    onPrevious,
    onNext,
    onSeek,
    onVolume,
    onFocusSearch
  });

  stateRef.current = {
    hasCurrent,
    hasNext,
    currentTime,
    duration,
    volume,
    usesSystemVolume,
    onTogglePlay,
    onPrevious,
    onNext,
    onSeek,
    onVolume,
    onFocusSearch
  };

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isDesktopShortcutTargetInteractive(event.target)) return;
      const action = resolveDesktopShortcut(event);
      if (!action) return;

      const state = stateRef.current;

      if (action === 'focus-search') {
        if (!state.onFocusSearch) return;
        event.preventDefault();
        state.onFocusSearch();
        return;
      }

      if (!state.hasCurrent) return;

      if (action === 'toggle-play') {
        if (!state.onTogglePlay) return;
        event.preventDefault();
        state.onTogglePlay();
        return;
      }

      if (action === 'previous') {
        if (!state.onPrevious) return;
        event.preventDefault();
        state.onPrevious();
        return;
      }

      if (action === 'next') {
        if (!state.onNext || !state.hasNext) return;
        event.preventDefault();
        state.onNext();
        return;
      }

      if (action === 'seek-backward' || action === 'seek-forward') {
        if (!state.onSeek) return;
        const delta = action === 'seek-forward' ? DESKTOP_SEEK_STEP_SECONDS : -DESKTOP_SEEK_STEP_SECONDS;
        const maximum = Number.isFinite(state.duration) && state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY;
        const nextTime = Math.min(maximum, Math.max(0, state.currentTime + delta));
        event.preventDefault();
        state.onSeek(nextTime);
        return;
      }

      if (state.usesSystemVolume || !state.onVolume) return;
      const delta = action === 'volume-up' ? DESKTOP_VOLUME_STEP : -DESKTOP_VOLUME_STEP;
      event.preventDefault();
      state.onVolume(Math.min(1, Math.max(0, state.volume + delta)));
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
