import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RHYTHM_ANALYSIS_ENABLED,
  parseRhythmAnalysisEnabled
} from './rhythm-analysis-config.js';

test('análise rítmica fica habilitada por padrão', () => {
  assert.equal(DEFAULT_RHYTHM_ANALYSIS_ENABLED, true);
  assert.equal(parseRhythmAnalysisEnabled(undefined), true);
  assert.equal(parseRhythmAnalysisEnabled(''), true);
});

test('parser aceita true/false sem depender de caixa ou espaços', () => {
  assert.equal(parseRhythmAnalysisEnabled(' true '), true);
  assert.equal(parseRhythmAnalysisEnabled('TRUE'), true);
  assert.equal(parseRhythmAnalysisEnabled(' false '), false);
  assert.equal(parseRhythmAnalysisEnabled('FALSE'), false);
});

test('parser rejeita configuração ambígua', () => {
  assert.throws(
    () => parseRhythmAnalysisEnabled('1'),
    /deve ser true ou false/
  );
});
