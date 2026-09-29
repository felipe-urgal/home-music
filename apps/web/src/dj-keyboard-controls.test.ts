import { describe, expect, it } from 'vitest';
import { clampDjKeyboardValue, resolveDjKeyboardCommand } from './dj-keyboard-controls';

describe('DJ keyboard controls', () => {
  it('mapeia transport e sync dos dois decks', () => {
    expect(resolveDjKeyboardCommand('1')).toEqual({ type: 'toggle-play', deck: 'a' });
    expect(resolveDjKeyboardCommand('2')).toEqual({ type: 'toggle-play', deck: 'b' });
    expect(resolveDjKeyboardCommand('Q')).toEqual({ type: 'cue', deck: 'a' });
    expect(resolveDjKeyboardCommand('w')).toEqual({ type: 'cue', deck: 'b' });
    expect(resolveDjKeyboardCommand('a')).toEqual({ type: 'sync', deck: 'a' });
    expect(resolveDjKeyboardCommand('S')).toEqual({ type: 'sync', deck: 'b' });
  });

  it('mapeia biblioteca, load e nudge', () => {
    expect(resolveDjKeyboardCommand('ArrowLeft')).toEqual({ type: 'library-move', delta: -1 });
    expect(resolveDjKeyboardCommand('ArrowRight')).toEqual({ type: 'library-move', delta: 1 });
    expect(resolveDjKeyboardCommand('z')).toEqual({ type: 'load', deck: 'a' });
    expect(resolveDjKeyboardCommand('x')).toEqual({ type: 'load', deck: 'b' });
    expect(resolveDjKeyboardCommand('r')).toEqual({ type: 'nudge', deck: 'a', delta: -1 });
    expect(resolveDjKeyboardCommand('u')).toEqual({ type: 'nudge', deck: 'b', delta: 1 });
  });

  it('mapeia mixer e ignora teclas não suportadas', () => {
    expect(resolveDjKeyboardCommand('g')).toEqual({ type: 'channel-volume', deck: 'a', delta: 0.05 });
    expect(resolveDjKeyboardCommand('h')).toEqual({ type: 'channel-volume', deck: 'b', delta: -0.05 });
    expect(resolveDjKeyboardCommand(',')).toEqual({ type: 'crossfader', delta: -0.1 });
    expect(resolveDjKeyboardCommand('.')).toEqual({ type: 'crossfader', delta: 0.1 });
    expect(resolveDjKeyboardCommand(' ')).toBeNull();
  });

  it('limita valores de mixer', () => {
    expect(clampDjKeyboardValue(1.05, 0, 1)).toBe(1);
    expect(clampDjKeyboardValue(-0.05, 0, 1)).toBe(0);
    expect(clampDjKeyboardValue(0.45, 0, 1)).toBe(0.45);
  });
});
