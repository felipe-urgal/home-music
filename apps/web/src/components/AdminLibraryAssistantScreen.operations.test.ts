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

  it('mantém metadata e letras em revisão selecionáveis, mas exige confirmação antes do lote', () => {
    const screen = source();

    expect(screen).toMatch(/function canApplyInBatch\(suggestion: LibraryAssistantSuggestion\)/);
    expect(screen).toMatch(/suggestion\.target\.capability !== 'artwork' && isOpen\(suggestion\)/);
    expect(screen).toMatch(/visibleActionableSuggestions/);
    expect(screen).toMatch(/const reviewCount = chosen\.filter\(item => !isSafe\(item\)\)\.length;/);
    expect(screen).toMatch(/if \(reviewCount > 0 && !reviewConfirmed\)/);
    expect(screen).toMatch(/setConfirmReviewCount\(reviewCount\)/);
    expect(screen).toMatch(/Aplicar sugestões em Revisão\?/);
  });

  it('preserva capas como decisão individual e não as anuncia como lote seguro', () => {
    const screen = source();

    expect(screen).toMatch(/function isBatchSafe\(suggestion: LibraryAssistantSuggestion\)/);
    expect(screen).toMatch(/return canApplyInBatch\(suggestion\) && isSafe\(suggestion\)/);
    expect(screen).toMatch(/safeSuggestions = useMemo\([\s\S]*isBatchSafe\(item\)/);
    expect(screen).toMatch(/reviewSuggestions = useMemo\([\s\S]*!isBatchSafe\(item\)/);
    expect(screen).toMatch(/suggestion\.target\.capability === 'artwork'/);
    expect(screen).toMatch(/expectedCurrentValue\(suggestion\)/);
    expect(screen).toMatch(/decideOne\(suggestion, 'apply'\)/);
    expect(screen).toContain('Aplicar capa');
    expect(screen).toMatch(/AssistantSuggestedArtwork/);
    expect(screen).toContain('/artwork-preview');
    expect(screen).not.toMatch(/src=\{target\.(thumbnailUrl|sourceUrl)\}/);
    expect(screen).toContain('Capas são aplicadas individualmente depois de conferir a imagem sugerida.');
    expect(screen).toMatch(/Capas continuam individuais\./);
  });

  it('mantém reanálise forte separada e move configurações para o cabeçalho', () => {
    const screen = source();

    expect(screen).toMatch(/resetLibraryAssistantReview\(\)/);
    expect(screen).toMatch(/startLibraryAssistantAnalysis\('all', \{ full: true \}\)/);
    expect(screen).toContain('Reanalisar toda a biblioteca');
    expect(screen).toContain('Configurações');
    expect(screen).toContain('assistant-v2__header-actions');
    expect(screen).not.toContain("['queue', 'Fila']");
    expect(screen).not.toContain("['statistics', 'Estatísticas']");
  });

  it('diferencia fila de execução ativa e prioriza filtros por tipo de sugestão', () => {
    const screen = source();

    expect(screen).toMatch(/run\.status === 'queued'\) return 'Análise na fila'/);
    expect(screen).toContain('Processamento em andamento');
    for (const label of ['Metadados', 'Capas', 'Letras', 'Revisão', 'Falhas']) {
      expect(screen).toContain(label);
    }
    expect(screen).toMatch(/filter === 'metadata'.*capability !== 'metadata'/s);
    expect(screen).toMatch(/filter === 'artwork'.*capability !== 'artwork'/s);
    expect(screen).toMatch(/filter === 'lyrics'.*capability !== 'lyrics'/s);
  });

  it('remove sugestões resolvidas da lista operacional após recarregar', () => {
    const screen = source();

    expect(screen).toMatch(/reviewableSuggestions = useMemo/);
    expect(screen).toMatch(/suggestions\.filter\(item => isOpen\(item\) \|\| item\.status === 'failed'\)/);
    expect(screen).toMatch(/const filtered = reviewableSuggestions\.filter/);
    expect(screen).toContain('{reviewableSuggestions.length.toLocaleString(\'pt-BR\')}');
  });

  it('mantém lyrics local dentro das Configurações em vez de launcher flutuante', () => {
    const screen = source();

    expect(screen).toContain('Abrir lyrics local');
    expect(screen).toContain('Fallback opcional com Whisper');
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

  it('diferencia biblioteca, sugestões e processamento no novo hero', () => {
    const screen = source();

    expect(screen).toMatch(/listAdminTracks/);
    expect(screen).toContain('faixas na biblioteca');
    expect(screen).toContain('sugestões abertas');
    expect(screen).toContain('falhas de processamento');
    expect(screen).toContain('Processamento finalizado');
  });




  it('separa progresso por processo e mostra quando haverá nova tentativa', () => {
    const screen = source();

    expect(screen).toMatch(/const metadataProgress = metadataRun/);
    expect(screen).toMatch(/const artworkProgress = artworkRun/);
    expect(screen).toMatch(/const lyricsProgress = lyricsRun/);
    expect(screen).toContain('aguardando nova tentativa');
    expect(screen).toContain('próxima tentativa em');
    expect(screen).toContain('falhas definitivas');
    expect(screen).toMatch(/progressLabel\(artworkProgress, artworkRun\)/);
  });

  it('não usa falhas de processamento como contador do filtro de sugestões', () => {
    const screen = source();

    expect(screen).toMatch(/const failedSuggestionCount = reviewableSuggestions\.filter\(item => item\.status === 'failed'\)\.length/);
    expect(screen).toContain('Falhas de sugestão');
    expect(screen).toContain('Não entram na fila de sugestões');
  });

  it('implementa lista com inspetor lateral e paginação de 50 itens', () => {
    const screen = source();

    expect(screen).toContain('assistant-v2__workspace');
    expect(screen).toContain('assistant-v2__table');
    expect(screen).toContain('assistant-v2__inspector');
    expect(screen).toMatch(/visibleSuggestions\.slice\(\(suggestionPage - 1\) \* 50, suggestionPage \* 50\)/);
    expect(screen).toContain('50 por página');
  });

  it('mantém aplicação segura em lote separada da revisão manual', () => {
    const screen = source();

    expect(screen).toContain('Aplicar sugestões seguras');
    expect(screen).toMatch(/applySuggestions\(safeSuggestions\)/);
    expect(screen).toContain('precisam de revisão');
    expect(screen).toContain('Exigem sua decisão');
  });

  it('coordena capabilities ativas até todas concluírem', () => {
    const screen = source();

    expect(screen).toMatch(/const analysisRuns = useMemo/);
    expect(screen).toMatch(/const runActive = activeRuns\.length > 0/);
    expect(screen).toMatch(/Promise\.all\(currentRuns\.map\(run => getLibraryAssistantRunProgress\(run\.id\)\)\)/);
    expect(screen).toMatch(/suggestionResponses\.flatMap/);
  });

  it('expõe automação segura em vez de manter comportamento de fundo oculto', () => {
    const screen = source();

    expect(screen).toContain('Automação segura');
    expect(screen).toMatch(/somente campos de metadata vazios/i);
    expect(screen).toMatch(/getLibraryAssistantAutonomy/);
    expect(screen).toMatch(/updateLibraryAssistantAutonomy/);
  });

  it('usa nomes de política que descrevem o comportamento real', () => {
    const screen = source();

    expect(screen).toContain('Ocultar');
    expect(screen).toContain('Revisar individualmente');
    expect(screen).toContain('Permitir lote seguro');
  });

  it('explica que a reanálise completa percorre toda a biblioteca', () => {
    const screen = source();

    expect(screen).toContain('refazer a análise de toda a biblioteca');
    expect(screen).toContain('Força uma nova análise de toda a biblioteca.');
    expect(screen).toContain('Reanálise completa de toda a biblioteca iniciada.');
  });

  it('não mostra 100% enquanto ainda existem verificações por concluir', () => {
    const screen = source();

    expect(screen).toMatch(/Math\.min\(processedChecks < totalChecks \? 99 : 100, Math\.round/);
  });

  it('oferece ações separadas para cada tipo de análise', () => {
    const screen = source();

    for (const label of ['Título', 'Artista', 'Álbum', 'Artista do álbum', 'Capas', 'Letras', 'Tudo']) {
      expect(screen).toContain(label);
    }
    expect(screen).toContain('Escolher análise');
    expect(screen).toMatch(/startLibraryAssistantAnalysis\(target, \{ full \}\)/);
    expect(screen).toContain('Busca somente capas ausentes');
  });

});
