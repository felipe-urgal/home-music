import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source() {
  return readFileSync(new URL('AdminLibraryAssistantTabbedScreen.tsx', import.meta.url), 'utf8');
}

describe('AdminLibraryAssistantTabbedScreen', () => {
  it('separa a Assistente em Metadados, Capas e Letras com análise própria', () => {
    const screen = source();

    expect(screen).toMatch(/const CAPABILITY_TABS: readonly CapabilityTab\[\] = \['metadata', 'artwork', 'lyrics'\]/);
    expect(screen).toContain('Metadados');
    expect(screen).toContain('Capas');
    expect(screen).toContain('Letras');
    expect(screen).toMatch(/startLibraryAssistantRun\(capability, \{ full: true \}\)/);
    expect(screen).toMatch(/runIsActive\(runByCapability\[capability\]\)/);
    expect(screen).toMatch(/cancelSingleLibraryAssistantRun\(run\.id\)/);
  });

  it('carrega todas as faixas e combina o estado persistido da análise por trackId', () => {
    const screen = source();

    expect(screen).toMatch(/listAdminTracks\(\)/);
    expect(screen).toMatch(/getLibraryAssistantRunTracks\(run\.id\)/);
    expect(screen).toMatch(/tracks\.map\(track => \{/);
    expect(screen).toMatch(/activeRunStates\.get\(track\.id\)/);
    expect(screen).toContain('Não analisado');
    expect(screen).toContain('Em análise');
    expect(screen).toContain('Revisar');
    expect(screen).toContain('Sugestões');
    expect(screen).toContain('Falhas');
  });

  it('mantém a revisão limitada ao run atual de cada aba', () => {
    const screen = source();

    expect(screen).toMatch(/if \(activeRun && suggestion\.runId !== activeRun\.id\) continue;/);
    expect(screen).toMatch(/item\.target\.capability === activeTab[\s\S]*item\.runId === activeRun\.id/);
  });

  it('preserva lote seguro, preview de capa, lyrics local e identificação por áudio', () => {
    const screen = source();

    expect(screen).toMatch(/safeBatchSuggestions/);
    expect(screen).toMatch(/decideLibraryAssistantBatch/);
    expect(screen).toContain('SuggestedArtwork');
    expect(screen).toContain('Lyrics local');
    expect(screen).toMatch(/fingerprintLibraryAssistantSuggestion/);
    expect(screen).toContain('Identificar pelo áudio');
  });
});
