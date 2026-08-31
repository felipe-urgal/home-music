import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const componentDir = fileURLToPath(new URL('.', import.meta.url));

function source(name: string) {
  return readFileSync(new URL(name, `file://${componentDir}/`), 'utf8');
}

test('LibraryScreen permanece como orquestrador das superfícies extraídas', () => {
  const screen = source('LibraryScreen.tsx');

  for (const component of [
    'LibraryNavigationChrome',
    'LibraryViewTools',
    'LibraryContent'
  ]) {
    assert.match(screen, new RegExp(`<${component}\\b`));
  }

  assert.doesNotMatch(screen, /className="library-track-list"/);
  assert.doesNotMatch(screen, /className="library-smart-view-tools"/);
  assert.doesNotMatch(screen, /className="library-content"/);
});

test('adaptação mobile e desktop de faixas fica isolada em LibraryTrackRows', () => {
  const rows = source('LibraryTrackRows.tsx');

  assert.match(rows, /useDesktopLayout\(\)/);
  assert.match(rows, /<DesktopTrackTable\b/);
  assert.match(rows, /className="library-track-list"/);
});
