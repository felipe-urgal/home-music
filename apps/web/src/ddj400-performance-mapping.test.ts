import { describe, expect, it } from 'vitest';
import {
  DDJ400_TEMPO_RANGE_PERCENT,
  Ddj400PerformanceMapper
} from './ddj400-performance-mapping';
import type { NormalizedMidiMessage } from './web-midi';

function msg(status: number, channel: number, data1: number, data2: number): NormalizedMidiMessage {
  return { timestamp: 0, status, channel, data1, data2, sourceId: 'ddj-400' };
}

describe('DDJ-400 performance mapping', () => {
  it('converte tempo 14-bit em rate com faixa explícita', () => {
    const mapper = new Ddj400PerformanceMapper();
    expect(DDJ400_TEMPO_RANGE_PERCENT).toBe(6);

    expect(mapper.decode(msg(0xb0, 0, 0x20, 0))).toBeNull();
    const command = mapper.decode(msg(0xb0, 0, 0x00, 64));

    expect(command?.type).toBe('deck.set-tempo');
    if (command?.type === 'deck.set-tempo') {
      expect(command.deck).toBe('a');
      expect(command.playbackRate).toBeGreaterThan(0.99);
      expect(command.playbackRate).toBeLessThan(1.01);
    }
  });

  it('mantém estado 14-bit independente por deck', () => {
    const mapper = new Ddj400PerformanceMapper();

    mapper.decode(msg(0xb0, 0, 0x20, 127));
    mapper.decode(msg(0xb0, 1, 0x20, 0));
    const a = mapper.decode(msg(0xb0, 0, 0x00, 127));
    const b = mapper.decode(msg(0xb0, 1, 0x00, 0));

    expect(a).toMatchObject({ type: 'deck.set-tempo', deck: 'a' });
    expect(b).toMatchObject({ type: 'deck.set-tempo', deck: 'b' });
  });

  it('mapeia jog como nudge relativo e ignora centro', () => {
    const mapper = new Ddj400PerformanceMapper();

    expect(mapper.decode(msg(0xb0, 0, 0x21, 65))).toEqual({
      type: 'deck.nudge',
      deck: 'a',
      delta: -1
    });
    expect(mapper.decode(msg(0xb0, 1, 0x23, 1))).toEqual({
      type: 'deck.nudge',
      deck: 'b',
      delta: 1
    });
    expect(mapper.decode(msg(0xb0, 0, 0x21, 64))).toBeNull();
  });

  it('mapeia beat sync e ignora release', () => {
    const mapper = new Ddj400PerformanceMapper();

    expect(mapper.decode(msg(0x90, 0, 0x58, 127))).toEqual({ type: 'deck.sync', deck: 'a' });
    expect(mapper.decode(msg(0x90, 1, 0x58, 0))).toBeNull();
  });

  it('ignora mensagens fora do mapping de performance', () => {
    const mapper = new Ddj400PerformanceMapper();
    expect(mapper.decode(msg(0xb0, 0, 0x7f, 10))).toBeNull();
  });
});
