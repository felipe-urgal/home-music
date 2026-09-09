import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source() {
  return readFileSync(new URL('AdminLibraryAssistantScreen.tsx', import.meta.url), 'utf8');
}

describe('AdminLibraryAssistantScreen operational workflow', () => {
  it('envia seleção em lotes reais de no máximo 100 decisões', () => {
    const screen = source();

    expect(screen).toMatch(/const BATCH_SIZE = 100;/);
    expect(screen).toMatch(/for \(let offset = 0; offset < decisions\.length; offset \+= BATCH_SIZE\)/);
    expect(screen).toMatch(/decisions\.slice\(offset, offset \+ BATCH_SIZE\)/);
    expect(screen).toMatch(/decideLibraryAssistantBatch\(chunk, \{ confirmReview: reviewCount > 0 \}\)/);
  });

  it('mantém metadata em revisão selecionável, mas exige confirmação antes do lote', () => {
    const screen = source();

    expect(screen).toMatch(/function canApplyInBatch\(suggestion: LibraryAssistantSuggestion\)/);
    expect(screen).toMatch(/suggestion\.target\.capability === 'metadata' && isOpen\(suggestion\)/);
    expect(screen).toMatch(/visibleActionableSuggestions/);
    expect(screen).toMatch(/const reviewCount = chosen\.filter\(item => !isSafe\(item\)\)\.length;/);
    expect(screen).toMatch(/if \(reviewCount > 0 && !reviewConfirmed\)/);
    expect(screen).toMatch(/setConfirmReviewCount\(reviewCount\)/);
    expect(screen).toMatch(/Aplicar sugestões em Revisão\?/);
  });

  it('preserva capas como decisão individual mesmo quando o lote de metadata é confirmado', () => {
    const screen = source();

    expect(screen).toMatch(/suggestion\.target\.capability === 'artwork'/);
    expect(screen).toMatch(/expectedCurrentValue\(suggestion\)/);
    expect(screen).toContain('capas continuam com aplicação individual');
  });

  it('mantém reset forte separado da análise incremental e expõe as quatro seções', () => {
    const screen = source();

    expect(screen).toMatch(/resetLibraryAssistantReview\(\)/);
    expect(screen).toMatch(/startLibraryAssistantMetadataRun\(\{ full: true \}\)/);
    expect(screen).toMatch(/Limpar e reanalisar tudo/);
    for (const label of ['Sugestões', 'Fila', 'Estatísticas', 'Configurações']) {
      expect(screen).toContain(label);
    }
  });

  it('expõe detalhes dos resultados de lote em vez de reduzir tudo a erro genérico', () => {
    const screen = source();

    expect(screen).toMatch(/result\.outcome === 'not-found'/);
    expect(screen).toMatch(/result\.outcome === 'unsupported'/);
    expect(screen).toMatch(/result\.outcome === 'stale'/);
    expect(screen).toMatch(/result\.message/);
    expect(screen).toMatch(/<summary>Ver detalhes<\/summary>/);
  });

  it('fecha confirmações com Escape e fornece foco inicial no diálogo', () => {
    const screen = source();

    expect(screen).toMatch(/event\.key !== 'Escape'/);
    expect(screen).toMatch(/setConfirmReviewCount\(0\)/);
    expect(screen).toMatch(/setConfirmReset\(false\)/);
    expect(screen).toMatch(/<button autoFocus/);
  });
});
