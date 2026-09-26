import type { DjDeckId } from './dj-controller-contract';
import type { NormalizedMidiMessage } from './web-midi';

type MidiBinding = {
  status: number;
  channel: number;
  data1: number;
};

export const DDJ400_MIDI_FIXTURES = {
  browser: {
    rotate: { status: 0xb0, channel: 6, data1: 0x40 },
    press: { status: 0x90, channel: 6, data1: 0x41 },
    loadA: { status: 0x90, channel: 6, data1: 0x46 },
    loadB: { status: 0x90, channel: 6, data1: 0x47 }
  },
  transport: {
    playA: { status: 0x90, channel: 0, data1: 0x0b },
    playB: { status: 0x90, channel: 1, data1: 0x0b },
    cueA: { status: 0x90, channel: 0, data1: 0x0c },
    cueB: { status: 0x90, channel: 1, data1: 0x0c },
    syncA: { status: 0x90, channel: 0, data1: 0x58 },
    syncB: { status: 0x90, channel: 1, data1: 0x58 }
  },
  tempo: {
    lsb: 0x20,
    msb: 0x00
  },
  jog: {
    controls: [0x21, 0x22, 0x23, 0x29] as const,
    neutral: 64
  },
  mixer: {
    channelLsb: 0x33,
    channelMsb: 0x13,
    crossfaderLsb: 0x3f,
    crossfaderMsb: 0x1f,
    crossfaderChannel: 6
  },
  led: {
    play: 0x0b,
    cue: 0x0c,
    sync: 0x58,
    on: 0x7f,
    off: 0x00
  }
} as const;

export function ddj400DeckStatus(deck: DjDeckId) {
  return deck === 'a' ? 0x90 : 0x91;
}

export function ddj400DeckChannel(deck: DjDeckId) {
  return deck === 'a' ? 0 : 1;
}

export function ddj400Message(
  binding: MidiBinding,
  data2: number,
  sourceId = 'ddj-400'
): NormalizedMidiMessage {
  return {
    timestamp: 0,
    status: binding.status,
    channel: binding.channel,
    data1: binding.data1,
    data2,
    sourceId
  };
}

export function ddj400Cc(
  deck: DjDeckId,
  data1: number,
  data2: number,
  sourceId = 'ddj-400'
): NormalizedMidiMessage {
  return {
    timestamp: 0,
    status: 0xb0,
    channel: ddj400DeckChannel(deck),
    data1,
    data2,
    sourceId
  };
}
