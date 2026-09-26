import { describe, expect, it } from 'vitest';
import { isDjKeyboardEditableTarget, mapDjKeyboardCode } from './dj-keyboard-mapping';

describe('DJ keyboard mapping', () => {
  it('mapeia transport dos dois decks', () => {
    expect(mapDjKeyboardCode('Digit1')).toMatchObject({ type: 'deck.toggle-play', deck: 'a', repeatable: false });
    expect(mapDjKeyboardCode('Digit2')).toMatchObject({ type: 'deck.toggle-play', deck: 'b', repeatable: false });
    expect(mapDjKeyboardCode('KeyQ')).toMatchObject({ type: 'deck.cue', deck: 'a' });
    expect(mapDjKeyboardCode('KeyW')).toMatchObject({ type: 'deck.cue', deck: 'b' });
    expect(mapDjKeyboardCode('KeyA')).toMatchObject({ type: 'deck.sync', deck: 'a' });
    expect(mapDjKeyboardCode('KeyS')).toMatchObject({ type: 'deck.sync', deck: 'b' });
  });

  it('mapeia biblioteca, nudge e mixer como comandos contínuos quando apropriado', () => {
    expect(mapDjKeyboardCode('ArrowLeft')).toEqual({ type: 'browser.move', delta: -1, repeatable: true });
    expect(mapDjKeyboardCode('ArrowRight')).toEqual({ type: 'browser.move', delta: 1, repeatable: true });
    expect(mapDjKeyboardCode('KeyZ')).toEqual({ type: 'browser.load', deck: 'a', repeatable: false });
    expect(mapDjKeyboardCode('KeyX')).toEqual({ type: 'browser.load', deck: 'b', repeatable: false });
    expect(mapDjKeyboardCode('KeyR')).toEqual({ type: 'deck.nudge', deck: 'a', delta: -1, repeatable: true });
    expect(mapDjKeyboardCode('KeyU')).toEqual({ type: 'deck.nudge', deck: 'b', delta: 1, repeatable: true });
    expect(mapDjKeyboardCode('KeyF')).toEqual({ type: 'mixer.channel', deck: 'a', delta: -1, repeatable: true });
    expect(mapDjKeyboardCode('KeyJ')).toEqual({ type: 'mixer.channel', deck: 'b', delta: 1, repeatable: true });
    expect(mapDjKeyboardCode('Comma')).toEqual({ type: 'mixer.crossfader', delta: -1, repeatable: true });
    expect(mapDjKeyboardCode('Period')).toEqual({ type: 'mixer.crossfader', delta: 1, repeatable: true });
  });

  it('ignora teclas fora do mapa', () => {
    expect(mapDjKeyboardCode('Space')).toBeNull();
    expect(mapDjKeyboardCode('Escape')).toBeNull();
  });

  it('identifica campos editáveis sem depender do DOM', () => {
    expect(isDjKeyboardEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isDjKeyboardEditableTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(isDjKeyboardEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isDjKeyboardEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isDjKeyboardEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
    expect(isDjKeyboardEditableTarget(null)).toBe(false);
  });
});
