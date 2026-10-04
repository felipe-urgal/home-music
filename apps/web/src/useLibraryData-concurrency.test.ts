import { describe, expect, it } from 'vitest';
import {
  isLatestRequestGeneration,
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
    let appliedValue = '';
    const first = deferred<string>();
    const second = deferred<string>();

    const apply = async (promise: Promise<string>) => {
      const generation = ++currentGeneration;
      const value = await promise;
      if (isLatestRequestGeneration(generation, currentGeneration)) {
        appliedValue = value;
      }
    };

    const firstRun = apply(first.promise);
    const secondRun = apply(second.promise);

    second.resolve('snapshot novo');
    await secondRun;
    expect(appliedValue).toBe('snapshot novo');

    first.resolve('snapshot antigo');
    await firstRun;
    expect(appliedValue).toBe('snapshot novo');
  });

  it('considera qualquer mudança de revision como sinal para reconciliar a biblioteca', () => {
    expect(shouldRefreshLibraryFromStatus(8, 8)).toBe(false);
    expect(shouldRefreshLibraryFromStatus(9, 8)).toBe(true);
    expect(shouldRefreshLibraryFromStatus(1, 8)).toBe(true);
  });
});
