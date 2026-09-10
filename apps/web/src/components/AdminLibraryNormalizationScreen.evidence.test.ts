import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source() {
  return readFileSync(new URL('AdminLibraryNormalizationScreen.tsx', import.meta.url), 'utf8');
}

describe('AdminLibraryNormalizationScreen assistant evidence', () => {
  it('prioriza a grafia sugerida somente quando a evidência externa não conflita', () => {
    const screen = source();

    expect(screen).toMatch(/const suggested = !evidence\?\.conflict \? evidence\?\.suggestedCanonical : null/);
    expect(screen).toContain('MusicBrainz corrobora');
    expect(screen).toContain('IDs externos conflitantes');
  });

  it('mantém associação explícita e explica que MusicBrainz é apenas evidência', () => {
    const screen = source();

    expect(screen).toContain('Escolha qual grafia será exibida como canônica.');
    expect(screen).toContain('Associar variações');
    expect(screen).toContain('nenhuma grafia é sugerida automaticamente');
  });
});
