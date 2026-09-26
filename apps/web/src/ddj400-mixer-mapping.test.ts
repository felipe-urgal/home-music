import { describe, expect, it } from 'vitest';
import { Ddj400MixerMapper } from './ddj400-mixer-mapping';
import type { NormalizedMidiMessage } from './web-midi';

function msg(status: number, channel: number, data1: number, data2: number): NormalizedMidiMessage {
  return { timestamp: 0, status, channel, data1, data2, sourceId: 'ddj-400' };
}

describe('DDJ-400 mixer mapping', () => {
  it('mapeia channel fader A e B de forma independente', () => {
    const mapper = new Ddj400MixerMapper();

    expect(mapper.decode(msg(0xb0, 0, 0x33, 0))).toBeNull();
    const a = mapper.decode(msg(0xb0, 0, 0x13, 127));
    mapper.decode(msg(0xb0, 1, 0x33, 127));
    const b = mapper.decode(msg(0xb0, 1, 0x13, 0));

    expect(a).toMatchObject({ type: 'mixer.set-channel-volume', deck: 'a' });
    expect(b).toMatchObject({ type: 'mixer.set-channel-volume', deck: 'b' });
    if (a?.type === 'mixer.set-channel-volume') expect(a.value).toBeGreaterThan(0.99);
    if (b?.type === 'mixer.set-channel-volume') expect(b.value).toBeLessThan(0.01);
  });

  it('mapeia crossfader para -1..1', () => {
    const left = new Ddj400MixerMapper();
    left.decode(msg(0xb0, 6, 0x3f, 0));
    const leftCommand = left.decode(msg(0xb0, 6, 0x1f, 0));

    const right = new Ddj400MixerMapper();
    right.decode(msg(0xb0, 6, 0x3f, 127));
    const rightCommand = right.decode(msg(0xb0, 6, 0x1f, 127));

    expect(leftCommand).toEqual({ type: 'mixer.set-crossfader', value: -1 });
    expect(rightCommand?.type).toBe('mixer.set-crossfader');
    if (rightCommand?.type === 'mixer.set-crossfader') {
      expect(rightCommand.value).toBeGreaterThan(0.99);
    }
  });

  it('ignora mensagens fora do mixer', () => {
    const mapper = new Ddj400MixerMapper();
    expect(mapper.decode(msg(0x90, 0, 0x0b, 127))).toBeNull();
  });
});
