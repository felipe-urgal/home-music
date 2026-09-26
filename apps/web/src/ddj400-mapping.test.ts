import { describe, expect, it } from 'vitest';
import { decodeDdj400Message, DDJ400_MAPPING_VERSION } from './ddj400-mapping';
import { DDJ400_MIDI_FIXTURES, ddj400Message } from './ddj400-midi-fixtures';

describe('DDJ-400 basic mapping', () => {
  it('versiona o mapping', () => {
    expect(DDJ400_MAPPING_VERSION).toBe(1);
  });

  it('mapeia browser rotary em ambas as direções', () => {
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.browser.rotate, 1))).toEqual({ type: 'browser.move', delta: 1 });
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.browser.rotate, 127))).toEqual({ type: 'browser.move', delta: -1 });
  });

  it('mapeia LOAD esquerdo e direito', () => {
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.browser.loadA, 127))).toEqual({ type: 'browser.load', deck: 'a' });
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.browser.loadB, 127))).toEqual({ type: 'browser.load', deck: 'b' });
  });

  it('mapeia PLAY e CUE por deck', () => {
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.transport.playA, 127))).toEqual({ type: 'deck.toggle-play', deck: 'a' });
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.transport.playB, 127))).toEqual({ type: 'deck.toggle-play', deck: 'b' });
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.transport.cueA, 127))).toEqual({ type: 'deck.set-cue', deck: 'a' });
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.transport.cueB, 127))).toEqual({ type: 'deck.set-cue', deck: 'b' });
  });

  it('ignora note-off/velocity zero para evitar ação dupla', () => {
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.transport.playA, 0))).toBeNull();
    expect(decodeDdj400Message(ddj400Message(DDJ400_MIDI_FIXTURES.browser.loadA, 0))).toBeNull();
  });

  it('ignora mensagens desconhecidas', () => {
    expect(decodeDdj400Message(ddj400Message({ status: 0x90, channel: 0, data1: 0x7f }, 127))).toBeNull();
  });
});
