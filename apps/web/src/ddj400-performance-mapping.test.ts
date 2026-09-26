import { describe, expect, it } from 'vitest';
import {
  DDJ400_TEMPO_RANGE_PERCENT,
  Ddj400PerformanceMapper
} from './ddj400-performance-mapping';
import { DDJ400_MIDI_FIXTURES, ddj400Cc, ddj400Message } from './ddj400-midi-fixtures';

describe('DDJ-400 performance mapping', () => {
  it('converte tempo 14-bit em rate com faixa explícita', () => {
    const mapper = new Ddj400PerformanceMapper();
    expect(DDJ400_TEMPO_RANGE_PERCENT).toBe(6);

    expect(mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.tempo.lsb, 0))).toBeNull();
    const command = mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.tempo.msb, 64));

    expect(command?.type).toBe('deck.set-tempo');
    if (command?.type === 'deck.set-tempo') {
      expect(command.deck).toBe('a');
      expect(command.playbackRate).toBeGreaterThan(0.99);
      expect(command.playbackRate).toBeLessThan(1.01);
    }
  });

  it('mantém estado 14-bit independente por deck', () => {
    const mapper = new Ddj400PerformanceMapper();

    mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.tempo.lsb, 127));
    mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.tempo.lsb, 0));
    const a = mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.tempo.msb, 127));
    const b = mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.tempo.msb, 0));

    expect(a).toMatchObject({ type: 'deck.set-tempo', deck: 'a' });
    expect(b).toMatchObject({ type: 'deck.set-tempo', deck: 'b' });
  });

  it('mapeia jog como nudge relativo e ignora centro', () => {
    const mapper = new Ddj400PerformanceMapper();

    expect(mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.jog.controls[0], 65))).toEqual({
      type: 'deck.nudge',
      deck: 'a',
      delta: -1
    });
    expect(mapper.decode(ddj400Cc('b', DDJ400_MIDI_FIXTURES.jog.controls[2], 1))).toEqual({
      type: 'deck.nudge',
      deck: 'b',
      delta: 1
    });
    expect(mapper.decode(ddj400Cc('a', DDJ400_MIDI_FIXTURES.jog.controls[0], DDJ400_MIDI_FIXTURES.jog.neutral))).toBeNull();
  });

  it('mapeia beat sync e ignora release', () => {
    const mapper = new Ddj400PerformanceMapper();

    expect(mapper.decode(ddj400Message(DDJ400_MIDI_FIXTURES.transport.syncA, 127))).toEqual({ type: 'deck.sync', deck: 'a' });
    expect(mapper.decode(ddj400Message(DDJ400_MIDI_FIXTURES.transport.syncB, 0))).toBeNull();
  });

  it('processa burst de jog sem acumular estado inválido', () => {
    const mapper = new Ddj400PerformanceMapper();
    const commands = Array.from({ length: 500 }, (_, index) => (
      mapper.decode(ddj400Cc(index % 2 === 0 ? 'a' : 'b', DDJ400_MIDI_FIXTURES.jog.controls[0], index % 2 === 0 ? 1 : 127))
    ));

    expect(commands).toHaveLength(500);
    expect(commands.every(command => command?.type === 'deck.nudge')).toBe(true);
  });

  it('ignora mensagens fora do mapping de performance', () => {
    const mapper = new Ddj400PerformanceMapper();
    expect(mapper.decode(ddj400Cc('a', 0x7f, 10))).toBeNull();
  });
});
