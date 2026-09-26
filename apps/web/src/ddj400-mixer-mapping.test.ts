import { describe, expect, it } from 'vitest';
import { Ddj400MixerMapper } from './ddj400-mixer-mapping';
import { DDJ400_MIDI_FIXTURES, ddj400Cc, ddj400Message } from './ddj400-midi-fixtures';

describe('DDJ-400 mixer mapping', () => {
  it('mapeia channel fader A e B de forma independente', () => {
    const mapper = new Ddj400MixerMapper();

    expect(mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.mixer.channelLsb, 0))).toBeNull();
    const a = mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.mixer.channelMsb, 127));
    mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.mixer.channelLsb, 127));
    const b = mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.mixer.channelMsb, 0));

    expect(a).toMatchObject({ type: 'mixer.set-channel-volume', deck: 'a' });
    expect(b).toMatchObject({ type: 'mixer.set-channel-volume', deck: 'b' });
    if (a?.type === 'mixer.set-channel-volume') expect(a.value).toBeGreaterThan(0.99);
    if (b?.type === 'mixer.set-channel-volume') expect(b.value).toBeLessThan(0.01);
  });

  it('mapeia crossfader para -1..1', () => {
    const left = new Ddj400MixerMapper();
    left.decode(ddj400Message({ status: 0xb0, channel: DDJ400_MIDI_FIXTURES.mixer.crossfaderChannel, data1: DDJ400_MIDI_FIXTURES.mixer.crossfaderLsb }, 0));
    const leftCommand = left.decode(ddj400Message({ status: 0xb0, channel: DDJ400_MIDI_FIXTURES.mixer.crossfaderChannel, data1: DDJ400_MIDI_FIXTURES.mixer.crossfaderMsb }, 0));

    const right = new Ddj400MixerMapper();
    right.decode(ddj400Message({ status: 0xb0, channel: DDJ400_MIDI_FIXTURES.mixer.crossfaderChannel, data1: DDJ400_MIDI_FIXTURES.mixer.crossfaderLsb }, 127));
    const rightCommand = right.decode(ddj400Message({ status: 0xb0, channel: DDJ400_MIDI_FIXTURES.mixer.crossfaderChannel, data1: DDJ400_MIDI_FIXTURES.mixer.crossfaderMsb }, 127));

    expect(leftCommand).toEqual({ type: 'mixer.set-crossfader', value: -1 });
    expect(rightCommand?.type).toBe('mixer.set-crossfader');
    if (rightCommand?.type === 'mixer.set-crossfader') {
      expect(rightCommand.value).toBeGreaterThan(0.99);
    }
  });

  it('processa mudanças rápidas sem misturar estado entre controles', () => {
    const mapper = new Ddj400MixerMapper();

    for (let value = 0; value < 128; value += 1) {
      mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.mixer.channelLsb, value));
      mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.mixer.channelLsb, 127 - value));
      mapper.decode(ddj400Message({ status: 0xb0, channel: DDJ400_MIDI_FIXTURES.mixer.crossfaderChannel, data1: DDJ400_MIDI_FIXTURES.mixer.crossfaderLsb }, value));
    }

    const a = mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.mixer.channelMsb, 127));
    const b = mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.mixer.channelMsb, 0));
    const crossfader = mapper.decode(ddj400Message({ status: 0xb0, channel: DDJ400_MIDI_FIXTURES.mixer.crossfaderChannel, data1: DDJ400_MIDI_FIXTURES.mixer.crossfaderMsb }, 64));

    expect(a).toMatchObject({ type: 'mixer.set-channel-volume', deck: 'a' });
    expect(b).toMatchObject({ type: 'mixer.set-channel-volume', deck: 'b' });
    expect(crossfader?.type).toBe('mixer.set-crossfader');
  });

  it('ignora mensagens fora do mixer', () => {
    const mapper = new Ddj400MixerMapper();
    expect(mapper.decode(ddj400Message(DDJ400_MIDI_FIXTURES.transport.playA, 127))).toBeNull();
  });
});
