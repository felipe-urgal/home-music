import type { DjControllerCommand, DjDeckId } from './dj-controller-contract';
import type { NormalizedMidiMessage } from './web-midi';

type FourteenBitState = {
  msb: number | null;
  lsb: number | null;
};

export class Ddj400MixerMapper {
  private channel: Record<DjDeckId, FourteenBitState> = {
    a: { msb: null, lsb: null },
    b: { msb: null, lsb: null }
  };

  private crossfader: FourteenBitState = { msb: null, lsb: null };

  decode(message: NormalizedMidiMessage): DjControllerCommand | null {
    const deck = message.channel === 0 ? 'a' : message.channel === 1 ? 'b' : null;

    if (deck && message.status === 0xb0 && message.data1 === 0x33) {
      this.channel[deck].lsb = message.data2;
      return this.channelCommand(deck);
    }

    if (deck && message.status === 0xb0 && message.data1 === 0x13) {
      this.channel[deck].msb = message.data2;
      return this.channelCommand(deck);
    }

    if (message.channel === 6 && message.status === 0xb0 && message.data1 === 0x3f) {
      this.crossfader.lsb = message.data2;
      return this.crossfaderCommand();
    }

    if (message.channel === 6 && message.status === 0xb0 && message.data1 === 0x1f) {
      this.crossfader.msb = message.data2;
      return this.crossfaderCommand();
    }

    return null;
  }

  private channelCommand(deck: DjDeckId): DjControllerCommand | null {
    const state = this.channel[deck];
    if (state.msb == null || state.lsb == null) return null;
    const raw = (state.msb << 7) | state.lsb;
    return {
      type: 'mixer.set-channel-volume',
      deck,
      value: raw / 16383
    };
  }

  private crossfaderCommand(): DjControllerCommand | null {
    const state = this.crossfader;
    if (state.msb == null || state.lsb == null) return null;
    const raw = (state.msb << 7) | state.lsb;
    return {
      type: 'mixer.set-crossfader',
      value: (raw / 16383) * 2 - 1
    };
  }
}
