import type { DjDeckId } from './dj-controller-contract';
import { DDJ400_MIDI_FIXTURES, ddj400DeckStatus } from './ddj400-midi-fixtures';

export type Ddj400LedState = {
  play: Record<DjDeckId, boolean>;
  cue: Record<DjDeckId, boolean>;
  sync: Record<DjDeckId, boolean>;
};

type SendMidi = (data: number[]) => boolean;

const LED_NOTE = DDJ400_MIDI_FIXTURES.led;

export function ddj400LedMessage(
  deck: DjDeckId,
  kind: keyof typeof LED_NOTE,
  enabled: boolean
) {
  return [
    ddj400DeckStatus(deck),
    LED_NOTE[kind],
    enabled ? DDJ400_MIDI_FIXTURES.led.on : DDJ400_MIDI_FIXTURES.led.off
  ];
}

export class Ddj400LedRenderer {
  private cache = new Map<string, boolean>();

  constructor(private readonly send: SendMidi) {}

  reset() {
    this.cache.clear();
  }

  render(state: Ddj400LedState) {
    let sent = 0;
    for (const deck of ['a', 'b'] as const) {
      for (const kind of ['play', 'cue', 'sync'] as const) {
        const key = `${deck}:${kind}`;
        const enabled = state[kind][deck];
        if (this.cache.get(key) === enabled) continue;
        if (!this.send(ddj400LedMessage(deck, kind, enabled))) continue;
        this.cache.set(key, enabled);
        sent += 1;
      }
    }
    return sent;
  }

  clear() {
    const off: Ddj400LedState = {
      play: { a: false, b: false },
      cue: { a: false, b: false },
      sync: { a: false, b: false }
    };
    this.reset();
    return this.render(off);
  }
}
