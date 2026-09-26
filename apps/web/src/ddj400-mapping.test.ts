import { describe, expect, it } from 'vitest';
import { decodeDdj400Message, DDJ400_MAPPING_VERSION } from './ddj400-mapping';
import type { NormalizedMidiMessage } from './web-midi';

function msg(status: number, channel: number, data1: number, data2: number): NormalizedMidiMessage {
  return { timestamp: 0, status, channel, data1, data2, sourceId: 'ddj-400' };
}

describe('DDJ-400 basic mapping', () => {
  it('versiona o mapping', () => {
    expect(DDJ400_MAPPING_VERSION).toBe(1);
  });

  it('mapeia browser rotary em ambas as direções', () => {
    expect(decodeDdj400Message(msg(0xb0, 6, 0x40, 1))).toEqual({ type: 'browser.move', delta: 1 });
    expect(decodeDdj400Message(msg(0xb0, 6, 0x40, 127))).toEqual({ type: 'browser.move', delta: -1 });
  });

  it('mapeia LOAD esquerdo e direito', () => {
    expect(decodeDdj400Message(msg(0x90, 6, 0x46, 127))).toEqual({ type: 'browser.load', deck: 'a' });
    expect(decodeDdj400Message(msg(0x90, 6, 0x47, 127))).toEqual({ type: 'browser.load', deck: 'b' });
  });

  it('mapeia PLAY e CUE por deck', () => {
    expect(decodeDdj400Message(msg(0x90, 0, 0x0b, 127))).toEqual({ type: 'deck.toggle-play', deck: 'a' });
    expect(decodeDdj400Message(msg(0x90, 1, 0x0b, 127))).toEqual({ type: 'deck.toggle-play', deck: 'b' });
    expect(decodeDdj400Message(msg(0x90, 0, 0x0c, 127))).toEqual({ type: 'deck.set-cue', deck: 'a' });
    expect(decodeDdj400Message(msg(0x90, 1, 0x0c, 127))).toEqual({ type: 'deck.set-cue', deck: 'b' });
  });

  it('ignora note-off/velocity zero para evitar ação dupla', () => {
    expect(decodeDdj400Message(msg(0x90, 0, 0x0b, 0))).toBeNull();
    expect(decodeDdj400Message(msg(0x90, 6, 0x46, 0))).toBeNull();
  });

  it('ignora mensagens desconhecidas', () => {
    expect(decodeDdj400Message(msg(0x90, 0, 0x7f, 127))).toBeNull();
  });
});
