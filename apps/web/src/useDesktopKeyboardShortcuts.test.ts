import { describe, expect, it } from 'vitest';
import { resolveDesktopShortcut } from './useDesktopKeyboardShortcuts';

describe('desktop keyboard shortcuts', () => {
  it('mapeia transporte, seek, busca e volume', () => {
    expect(resolveDesktopShortcut({ key: ' ', code: 'Space' })).toBe('toggle-play');
    expect(resolveDesktopShortcut({ key: 'ArrowLeft' })).toBe('seek-backward');
    expect(resolveDesktopShortcut({ key: 'ArrowRight' })).toBe('seek-forward');
    expect(resolveDesktopShortcut({ key: 'ArrowLeft', shiftKey: true })).toBe('previous');
    expect(resolveDesktopShortcut({ key: 'ArrowRight', shiftKey: true })).toBe('next');
    expect(resolveDesktopShortcut({ key: 'ArrowUp' })).toBe('volume-up');
    expect(resolveDesktopShortcut({ key: 'ArrowDown' })).toBe('volume-down');
    expect(resolveDesktopShortcut({ key: '/' })).toBe('focus-search');
  });

  it('não captura combinações reservadas do navegador ou sistema', () => {
    expect(resolveDesktopShortcut({ key: ' ', code: 'Space', ctrlKey: true })).toBeNull();
    expect(resolveDesktopShortcut({ key: '/', metaKey: true })).toBeNull();
    expect(resolveDesktopShortcut({ key: 'ArrowRight', altKey: true })).toBeNull();
  });

  it('evita repetição acidental de play e troca de faixa', () => {
    expect(resolveDesktopShortcut({ key: ' ', code: 'Space', repeat: true })).toBeNull();
    expect(resolveDesktopShortcut({ key: 'ArrowLeft', shiftKey: true, repeat: true })).toBeNull();
    expect(resolveDesktopShortcut({ key: 'ArrowRight', shiftKey: true, repeat: true })).toBeNull();
    expect(resolveDesktopShortcut({ key: '/', repeat: true })).toBeNull();
  });

  it('permite repetição contínua para seek e volume', () => {
    expect(resolveDesktopShortcut({ key: 'ArrowLeft', repeat: true })).toBe('seek-backward');
    expect(resolveDesktopShortcut({ key: 'ArrowRight', repeat: true })).toBe('seek-forward');
    expect(resolveDesktopShortcut({ key: 'ArrowUp', repeat: true })).toBe('volume-up');
    expect(resolveDesktopShortcut({ key: 'ArrowDown', repeat: true })).toBe('volume-down');
  });
});
