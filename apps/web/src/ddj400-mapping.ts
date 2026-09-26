import type { DjControllerCommand, DjDeckId } from './dj-controller-contract';
import { DDJ400_MIDI_FIXTURES } from './ddj400-midi-fixtures';
import type { NormalizedMidiMessage } from './web-midi';

export const DDJ400_MAPPING_VERSION = 1;

export const DDJ400_MIDI = {
  browserRotate: DDJ400_MIDI_FIXTURES.browser.rotate,
  browserPress: DDJ400_MIDI_FIXTURES.browser.press,
  loadA: DDJ400_MIDI_FIXTURES.browser.loadA,
  loadB: DDJ400_MIDI_FIXTURES.browser.loadB,
  playA: DDJ400_MIDI_FIXTURES.transport.playA,
  playB: DDJ400_MIDI_FIXTURES.transport.playB,
  cueA: DDJ400_MIDI_FIXTURES.transport.cueA,
  cueB: DDJ400_MIDI_FIXTURES.transport.cueB
} as const;

type MidiBinding = {
  status: number;
  channel: number;
  data1: number;
};

function matches(
  message: NormalizedMidiMessage,
  mapping: MidiBinding
) {
  return message.status === mapping.status
    && message.channel === mapping.channel
    && message.data1 === mapping.data1;
}

function deckCommand(
  message: NormalizedMidiMessage,
  a: MidiBinding,
  b: MidiBinding,
  type: 'deck.toggle-play' | 'deck.set-cue'
): DjControllerCommand | null {
  if (message.data2 === 0) return null;
  if (matches(message, a)) return { type, deck: 'a' };
  if (matches(message, b)) return { type, deck: 'b' };
  return null;
}

export function decodeDdj400Message(message: NormalizedMidiMessage): DjControllerCommand | null {
  if (matches(message, DDJ400_MIDI.browserRotate)) {
    if (message.data2 === 0 || message.data2 === 64) return null;
    return { type: 'browser.move', delta: message.data2 < 64 ? 1 : -1 };
  }

  if (message.data2 !== 0 && matches(message, DDJ400_MIDI.browserPress)) {
    return { type: 'browser.select' };
  }
  if (message.data2 !== 0 && matches(message, DDJ400_MIDI.loadA)) {
    return { type: 'browser.load', deck: 'a' };
  }
  if (message.data2 !== 0 && matches(message, DDJ400_MIDI.loadB)) {
    return { type: 'browser.load', deck: 'b' };
  }

  return deckCommand(message, DDJ400_MIDI.playA, DDJ400_MIDI.playB, 'deck.toggle-play')
    ?? deckCommand(message, DDJ400_MIDI.cueA, DDJ400_MIDI.cueB, 'deck.set-cue');
}

export function ddj400DeckForChannel(channel: number): DjDeckId | null {
  if (channel === 0) return 'a';
  if (channel === 1) return 'b';
  return null;
}
