import type { DjDeckId } from './dj-controller-contract';

export type DualDeckMixerState = {
  channelVolumes: Record<DjDeckId, number>;
  crossfader: number;
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

export function resolveDualDeckOutputGain(options: {
  deck: DjDeckId;
  masterVolume: number;
  channelVolume: number;
  crossfader: number;
}) {
  const gains = crossfaderGains(options.crossfader);
  return clampUnit(options.masterVolume)
    * clampUnit(options.channelVolume)
    * gains[options.deck];
}

export function createDefaultDualDeckMixerState(): DualDeckMixerState {
  return {
    channelVolumes: { a: 1, b: 1 },
    crossfader: 0
  };
}
