import type { DjControllerCommand, DjDeckId } from './dj-controller-contract';
import type { NormalizedMidiMessage } from './web-midi';

export const DDJ400_TEMPO_RANGE_PERCENT = 6;
export const DDJ400_NUDGE_RATE_DELTA = 0.01;
export const DDJ400_SCRUB_SECONDS = 0.25;

type DeckTempoState = {
  msb: number | null;
  lsb: number | null;
};

export class Ddj400PerformanceMapper {
  private tempo: Record<DjDeckId, DeckTempoState> = {
    a: { msb: null, lsb: null },
    b: { msb: null, lsb: null }
  };

  decode(message: NormalizedMidiMessage): DjControllerCommand | null {
    const deck = message.channel === 0 ? 'a' : message.channel === 1 ? 'b' : null;
    if (!deck) return null;

    if (message.status === 0xb0 && message.data1 === 0x20) {
      this.tempo[deck].lsb = message.data2;
      return this.tempoCommand(deck);
    }

    if (message.status === 0xb0 && message.data1 === 0x00) {
      this.tempo[deck].msb = message.data2;
      return this.tempoCommand(deck);
    }

    if (
      message.status === 0xb0
      && (message.data1 === 0x21 || message.data1 === 0x22 || message.data1 === 0x23 || message.data1 === 0x29)
    ) {
      if (message.data2 === 64) return null;
      const direction = message.data2 < 64 ? 1 : -1;
      return { type: 'deck.nudge', deck, delta: direction };
    }

    if (message.status === 0x90 && message.data1 === 0x58 && message.data2 !== 0) {
      return { type: 'deck.sync', deck };
    }

    return null;
  }

  private tempoCommand(deck: DjDeckId): DjControllerCommand | null {
    const state = this.tempo[deck];
    if (state.msb == null || state.lsb == null) return null;

    const raw = (state.msb << 7) | state.lsb;
    const normalized = raw / 16383;
    const percent = ((normalized - 0.5) * 2) * DDJ400_TEMPO_RANGE_PERCENT;
    const playbackRate = Number((1 - (percent / 100)).toFixed(6));

    return {
      type: 'deck.set-tempo',
      deck,
      playbackRate
    };
  }
}
