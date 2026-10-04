import { describe, expect, it } from 'vitest';
import {
  shouldApplyLibrarySnapshot,
  shouldRefreshLibraryFromStatus
} from './useLibraryData';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(next => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('useLibraryData request ordering', () => {
  it('descarta a resposta anterior quando uma requisição mais nova termina primeiro', async () => {
    let currentGeneration = 0;
    let appliedGeneration = 0;
    let appliedRevision = 0;
    let appliedInstanceId: string | null = null;
    let appliedValue = '';
    const first = deferred<{ value: string; revision: number }>();
    const second = deferred<{ value: string; revision: number }>();

    const apply = async (promise: Promise<{ value: string; revision: number }>) => {
      const generation = ++currentGeneration;
      const result = await promise;
      if (!shouldApplyLibrarySnapshot(
        generation,
        currentGeneration,
        'server-a',
        result.revision,
        appliedInstanceId,
        appliedRevision
      )) return;

      appliedGeneration = generation;
      appliedInstanceId = 'server-a';
      appliedRevision = result.revision;
      appliedValue = result.value;
    };

    const firstRun = apply(first.promise);
    const secondRun = apply(second.promise);

    second.resolve({ value: 'snapshot novo', revision: 9 });
    await secondRun;
    expect({ appliedGeneration, appliedRevision, appliedValue }).toEqual({
      appliedGeneration: 2,
      appliedRevision: 9,
      appliedValue: 'snapshot novo'
    });

    first.resolve({ value: 'snapshot antigo', revision: 8 });
    await firstRun;
    expect({ appliedGeneration, appliedRevision, appliedValue }).toEqual({
      appliedGeneration: 2,
      appliedRevision: 9,
      appliedValue: 'snapshot novo'
    });
  });

  it('não aceita revision menor da mesma instância, mas aceita uma nova instância após restart', () => {
    expect(shouldApplyLibrarySnapshot(4, 4, 'server-a', 7, 'server-a', 8)).toBe(false);
    expect(shouldApplyLibrarySnapshot(4, 4, 'server-a', 8, 'server-a', 8)).toBe(true);
    expect(shouldApplyLibrarySnapshot(4, 4, 'server-b', 1, 'server-a', 8)).toBe(true);
  });

  it('reconcilia status quando a revision ou a instância do servidor muda', () => {
    expect(shouldRefreshLibraryFromStatus('server-a', 8, 'server-a', 8)).toBe(false);
    expect(shouldRefreshLibraryFromStatus('server-a', 9, 'server-a', 8)).toBe(true);
    expect(shouldRefreshLibraryFromStatus('server-b', 1, 'server-a', 8)).toBe(true);
  });
});
