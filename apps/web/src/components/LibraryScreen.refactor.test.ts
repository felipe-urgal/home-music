import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(name: string) {
  return readFileSync(new URL(name, import.meta.url), 'utf8');
}

describe('LibraryScreen responsibility boundaries', () => {
  it('mantém LibraryScreen como orquestrador das superfícies extraídas', () => {
    const screen = source('LibraryScreen.tsx');

    for (const component of [
      'LibraryNavigationChrome',
      'LibraryViewTools',
      'LibraryContent'
    ]) {
      expect(screen).toMatch(new RegExp(`<${component}\\b`));
    }

    expect(screen).not.toMatch(/className="library-track-list"/);
    expect(screen).not.toMatch(/className="library-smart-view-tools"/);
    expect(screen).not.toMatch(/className="library-content"/);
  });

  it('isola a adaptação mobile e desktop de faixas em LibraryTrackRows', () => {
    const rows = source('LibraryTrackRows.tsx');

    expect(rows).toMatch(/useDesktopLayout\(\)/);
    expect(rows).toMatch(/<DesktopTrackTable\b/);
    expect(rows).toMatch(/className="library-track-list"/);
  });
});
