import { describe, expect, it, vi } from 'vitest';
import {
  Ddj400LedRenderer,
  ddj400LedMessage,
  type Ddj400LedState
} from './ddj400-led-feedback';

function state(overrides: Partial<Ddj400LedState> = {}): Ddj400LedState {
  return {
    play: { a: false, b: false },
    cue: { a: false, b: false },
    sync: { a: false, b: false },
    ...overrides
  };
}

describe('DDJ-400 LED feedback', () => {
  it('gera bytes corretos para PLAY CUE e SYNC', () => {
    expect(ddj400LedMessage('a', 'play', true)).toEqual([0x90, 0x0b, 0x7f]);
    expect(ddj400LedMessage('b', 'cue', false)).toEqual([0x91, 0x0c, 0x00]);
    expect(ddj400LedMessage('b', 'sync', true)).toEqual([0x91, 0x58, 0x7f]);
  });

  it('deduplica renders sem mudança', () => {
    const send = vi.fn(() => true);
    const renderer = new Ddj400LedRenderer(send);
    const current = state({ play: { a: true, b: false } });

    expect(renderer.render(current)).toBe(6);
    expect(renderer.render(current)).toBe(0);
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('envia somente a transição alterada após hidratação', () => {
    const send = vi.fn(() => true);
    const renderer = new Ddj400LedRenderer(send);

    renderer.render(state());
    send.mockClear();

    expect(renderer.render(state({ cue: { a: true, b: false } }))).toBe(1);
    expect(send).toHaveBeenCalledWith([0x90, 0x0c, 0x7f]);
  });

  it('reset força reidratação completa no reconnect', () => {
    const send = vi.fn(() => true);
    const renderer = new Ddj400LedRenderer(send);
    const current = state({ sync: { a: false, b: true } });

    renderer.render(current);
    send.mockClear();
    renderer.reset();

    expect(renderer.render(current)).toBe(6);
    expect(send).toHaveBeenCalledTimes(6);
  });

  it('não memoriza envio que falhou por output ausente', () => {
    const send = vi.fn(() => false);
    const renderer = new Ddj400LedRenderer(send);

    expect(renderer.render(state())).toBe(0);
    expect(renderer.render(state())).toBe(0);
    expect(send).toHaveBeenCalledTimes(12);
  });

  it('desliga todos os LEDs no cleanup quando há output disponível', () => {
    const send = vi.fn(() => true);
    const renderer = new Ddj400LedRenderer(send);

    renderer.render(state({ play: { a: true, b: true }, sync: { a: true, b: false } }));
    send.mockClear();

    expect(renderer.clear()).toBe(6);
    expect(send).toHaveBeenCalledWith([0x90, 0x0b, 0x00]);
    expect(send).toHaveBeenCalledWith([0x91, 0x58, 0x00]);
  });
});
