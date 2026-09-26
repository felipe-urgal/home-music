import { describe, expect, it } from 'vitest';
import { nextDjAutomixIndex, shuffleDjTrackList } from './dj-automix-sequence';

describe('DJ AutoMix sequence', () => {
  it('segue a ordem atual da origem até o fim', () => {
    expect(nextDjAutomixIndex(3, -1)).toBe(0);
    expect(nextDjAutomixIndex(3, 0)).toBe(1);
    expect(nextDjAutomixIndex(3, 1)).toBe(2);
    expect(nextDjAutomixIndex(3, 2)).toBeNull();
  });

  it('embaralha somente os itens recebidos sem mutar a origem', () => {
    const source = ['a', 'b', 'c', 'd'];
    const values = [0, 0.9, 0.2];
    let index = 0;
    const shuffled = shuffleDjTrackList(source, () => values[index++] ?? 0.5);

    expect(source).toEqual(['a', 'b', 'c', 'd']);
    expect(shuffled).toHaveLength(source.length);
    expect(new Set(shuffled)).toEqual(new Set(source));
    expect(shuffled).not.toEqual(source);
  });

  it('não cria próxima faixa para origem vazia', () => {
    expect(nextDjAutomixIndex(0, -1)).toBeNull();
  });
});
