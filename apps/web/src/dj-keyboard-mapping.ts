import type { DjDeckId } from './dj-controller-contract';

export type DjKeyboardCommand =
  | { type: 'deck.toggle-play'; deck: DjDeckId; repeatable: false }
  | { type: 'deck.cue'; deck: DjDeckId; repeatable: false }
  | { type: 'deck.sync'; deck: DjDeckId; repeatable: false }
  | { type: 'browser.move'; delta: -1 | 1; repeatable: true }
  | { type: 'browser.load'; deck: DjDeckId; repeatable: false }
  | { type: 'deck.nudge'; deck: DjDeckId; delta: -1 | 1; repeatable: true }
  | { type: 'mixer.channel'; deck: DjDeckId; delta: -1 | 1; repeatable: true }
  | { type: 'mixer.crossfader'; delta: -1 | 1; repeatable: true };

const COMMANDS: Record<string, DjKeyboardCommand> = {
  Digit1: { type: 'deck.toggle-play', deck: 'a', repeatable: false },
  Digit2: { type: 'deck.toggle-play', deck: 'b', repeatable: false },
  KeyQ: { type: 'deck.cue', deck: 'a', repeatable: false },
  KeyW: { type: 'deck.cue', deck: 'b', repeatable: false },
  KeyA: { type: 'deck.sync', deck: 'a', repeatable: false },
  KeyS: { type: 'deck.sync', deck: 'b', repeatable: false },
  ArrowLeft: { type: 'browser.move', delta: -1, repeatable: true },
  ArrowRight: { type: 'browser.move', delta: 1, repeatable: true },
  KeyZ: { type: 'browser.load', deck: 'a', repeatable: false },
  KeyX: { type: 'browser.load', deck: 'b', repeatable: false },
  KeyR: { type: 'deck.nudge', deck: 'a', delta: -1, repeatable: true },
  KeyT: { type: 'deck.nudge', deck: 'a', delta: 1, repeatable: true },
  KeyY: { type: 'deck.nudge', deck: 'b', delta: -1, repeatable: true },
  KeyU: { type: 'deck.nudge', deck: 'b', delta: 1, repeatable: true },
  KeyF: { type: 'mixer.channel', deck: 'a', delta: -1, repeatable: true },
  KeyG: { type: 'mixer.channel', deck: 'a', delta: 1, repeatable: true },
  KeyH: { type: 'mixer.channel', deck: 'b', delta: -1, repeatable: true },
  KeyJ: { type: 'mixer.channel', deck: 'b', delta: 1, repeatable: true },
  Comma: { type: 'mixer.crossfader', delta: -1, repeatable: true },
  Period: { type: 'mixer.crossfader', delta: 1, repeatable: true }
};

export function mapDjKeyboardCode(code: string) {
  return COMMANDS[code] ?? null;
}

export function isDjKeyboardEditableTarget(target: EventTarget | null) {
  const candidate = target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = candidate?.tagName?.toUpperCase();
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || candidate?.isContentEditable === true;
}
