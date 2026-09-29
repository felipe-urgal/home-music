import type { DjDeckId } from './dj-controller-contract';

export type DjKeyboardCommand =
  | { type: 'toggle-play'; deck: DjDeckId }
  | { type: 'cue'; deck: DjDeckId }
  | { type: 'sync'; deck: DjDeckId }
  | { type: 'library-move'; delta: -1 | 1 }
  | { type: 'load'; deck: DjDeckId }
  | { type: 'nudge'; deck: DjDeckId; delta: -1 | 1 }
  | { type: 'channel-volume'; deck: DjDeckId; delta: -0.05 | 0.05 }
  | { type: 'crossfader'; delta: -0.1 | 0.1 };

export function resolveDjKeyboardCommand(key: string): DjKeyboardCommand | null {
  switch (key.toLowerCase()) {
    case '1': return { type: 'toggle-play', deck: 'a' };
    case '2': return { type: 'toggle-play', deck: 'b' };
    case 'q': return { type: 'cue', deck: 'a' };
    case 'w': return { type: 'cue', deck: 'b' };
    case 'a': return { type: 'sync', deck: 'a' };
    case 's': return { type: 'sync', deck: 'b' };
    case 'arrowleft': return { type: 'library-move', delta: -1 };
    case 'arrowright': return { type: 'library-move', delta: 1 };
    case 'z': return { type: 'load', deck: 'a' };
    case 'x': return { type: 'load', deck: 'b' };
    case 'r': return { type: 'nudge', deck: 'a', delta: -1 };
    case 't': return { type: 'nudge', deck: 'a', delta: 1 };
    case 'y': return { type: 'nudge', deck: 'b', delta: -1 };
    case 'u': return { type: 'nudge', deck: 'b', delta: 1 };
    case 'f': return { type: 'channel-volume', deck: 'a', delta: -0.05 };
    case 'g': return { type: 'channel-volume', deck: 'a', delta: 0.05 };
    case 'h': return { type: 'channel-volume', deck: 'b', delta: -0.05 };
    case 'j': return { type: 'channel-volume', deck: 'b', delta: 0.05 };
    case ',': return { type: 'crossfader', delta: -0.1 };
    case '.': return { type: 'crossfader', delta: 0.1 };
    default: return null;
  }
}

export function isDjKeyboardEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

export function clampDjKeyboardValue(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
