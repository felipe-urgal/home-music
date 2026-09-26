import { describe, expect, it } from 'vitest';
import {
  DDJ400_MIDI_FIXTURES,
  ddj400DeckChannel,
  ddj400DeckStatus,
  ddj400Message
} from './ddj400-midi-fixtures';

describe('DDJ-400 MIDI fixtures', () => {
  it('cobre todos os controles do MVP', () => {
    expect(DDJ400_MIDI_FIXTURES.browser).toEqual(expect.objectContaining({
      rotate: expect.any(Object),
      press: expect.any(Object),
      loadA: expect.any(Object),
      loadB: expect.any(Object)
    }));
    expect(DDJ400_MIDI_FIXTURES.transport).toEqual(expect.objectContaining({
      playA: expect.any(Object),
      playB: expect.any(Object),
      cueA: expect.any(Object),
      cueB: expect.any(Object),
      syncA: expect.any(Object),
      syncB: expect.any(Object)
    }));
    expect(DDJ400_MIDI_FIXTURES.jog.controls.length).toBeGreaterThan(0);
    expect(DDJ400_MIDI_FIXTURES.tempo).toEqual({ lsb: 0x20, msb: 0x00 });
    expect(DDJ400_MIDI_FIXTURES.mixer).toEqual(expect.objectContaining({
      channelLsb: 0x33,
      channelMsb: 0x13,
      crossfaderLsb: 0x3f,
      crossfaderMsb: 0x1f
    }));
    expect(DDJ400_MIDI_FIXTURES.led).toEqual(expect.objectContaining({
      play: 0x0b,
      cue: 0x0c,
      sync: 0x58,
      on: 0x7f,
      off: 0
    }));
  });

  it('mantém deck A/B consistente entre channel e status byte', () => {
    expect(ddj400DeckChannel('a')).toBe(0);
    expect(ddj400DeckChannel('b')).toBe(1);
    expect(ddj400DeckStatus('a')).toBe(0x90);
    expect(ddj400DeckStatus('b')).toBe(0x91);
  });

  it('cria mensagens normalizadas sem depender de hardware', () => {
    expect(ddj400Message(DDJ400_MIDI_FIXTURES.transport.playB, 127)).toEqual({
      timestamp: 0,
      status: 0x90,
      channel: 1,
      data1: 0x0b,
      data2: 127,
      sourceId: 'ddj-400'
    });
  });
});
