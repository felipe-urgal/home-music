import type { DjDeckId } from './dj-controller-contract';
import { createNeutralDjEqState, type DjChannelEqState } from './dj-eq';
import { createNeutralDjFxState, type DjFxState } from './dj-fx';

export type DualDeckMixerState = {
  channelVolumes: Record<DjDeckId, number>;
  crossfader: number;
  eq: Record<DjDeckId, DjChannelEqState>;
  fx: DjFxState;
};

export type DualDeckAutomixTransition = {
  fromDeck: DjDeckId;
  progress: number;
};

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function clampCrossfader(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function crossfaderGains(value: number): Record<DjDeckId, number> {
  const normalized = clampCrossfader(value);
  const angle = ((normalized + 1) * Math.PI) / 4;
  return {
    a: Math.cos(angle),
    b: Math.sin(angle)
  };
}

export function automixTransitionGains(
  fromDeck: DjDeckId,
  progress: number
): Record<DjDeckId, number> {
  const normalized = clampUnit(progress);
  const outgoing = Math.cos(normalized * Math.PI / 2);
  const incoming = Math.sin(normalized * Math.PI / 2);
  return fromDeck === 'a'
    ? { a: outgoing, b: incoming }
    : { a: incoming, b: outgoing };
}

export function automixTransitionToCrossfader(
  fromDeck: DjDeckId,
  progress: number
) {
  const normalized = clampUnit(progress);
  return fromDeck === 'a'
    ? -1 + (normalized * 2)
    : 1 - (normalized * 2);
}

export function resolveDualDeckOutputGain(options: {
  deck: DjDeckId;
  masterVolume: number;
  channelVolume: number;
  crossfader: number;
  automixTransition?: DualDeckAutomixTransition | null;
}) {
  const gains = options.automixTransition
    ? automixTransitionGains(
        options.automixTransition.fromDeck,
        options.automixTransition.progress
      )
    : crossfaderGains(options.crossfader);
  return clampUnit(options.masterVolume)
    * clampUnit(options.channelVolume)
    * gains[options.deck];
}

export function createDefaultDualDeckMixerState(): DualDeckMixerState {
  return {
    channelVolumes: { a: 1, b: 1 },
    crossfader: 0,
    eq: createNeutralDjEqState(),
    fx: createNeutralDjFxState()
  };
}
