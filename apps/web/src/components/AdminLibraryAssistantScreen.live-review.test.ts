import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source() {
  return readFileSync(new URL('AdminLibraryAssistantScreen.tsx', import.meta.url), 'utf8');
}

describe('AdminLibraryAssistantScreen live review', () => {
  it('permite decidir e aplicar sugestões prontas enquanto a análise continua', () => {
    const screen = source();

    expect(screen).toMatch(/if \(!decision \|\| mutating\) return;/);
    expect(screen).toMatch(/async function applySelected\(reviewConfirmed = false\) \{[\s\S]*await applySuggestions\(chosen, reviewConfirmed\);/);
    expect(screen).toMatch(/disabled=\{mutating \|\| activeTrackSelectedCount === 0\}/);
    expect(screen).toMatch(/const canDecide = Boolean\(reviewMap\.has\(suggestion\.id\) && expectedCurrentValue\(suggestion\) != null && isOpen\(suggestion\)\);/);
    expect(screen).toMatch(/disabled=\{!canApplyInBatch\(suggestion\)\}/);
    expect(screen).not.toMatch(/disabled=\{mutating \|\| runActive \|\| activeTrackSelectedCount === 0\}/);
  });

  it('mantém reanálise e reset bloqueados durante um run ativo', () => {
    const screen = source();

    expect(screen).toMatch(/async function analyze\(target: LibraryAssistantAnalysisTarget, full = false\) \{\s*if \(analyzing \|\| mutating \|\| runActive\) return;/);
    expect(screen).toMatch(/async function resetAndAnalyze\(\) \{\s*if \(analyzing \|\| mutating \|\| runActive\) return;/);
  });
});
