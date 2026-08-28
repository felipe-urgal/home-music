import { describe, expect, it } from 'vitest';
import { runAdminBatch, summarizeAdminBatch } from './admin-batch';

describe('runAdminBatch', () => {
  it('limita concorrência e preserva resultado parcial', async () => {
    let active = 0;
    let maxActive = 0;
    const progress: Array<[number, number]> = [];

    const result = await runAdminBatch([1, 2, 3, 4, 5], async item => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, item === 2 ? 8 : 2));
      active -= 1;
      if (item === 3) throw new Error('falha controlada');
    }, {
      concurrency: 2,
      onProgress: (completed, total) => progress.push([completed, total])
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(result.succeeded).toHaveLength(4);
    expect(result.failed).toEqual([{ item: 3, error: 'falha controlada' }]);
    expect(progress[0]).toEqual([0, 5]);
    expect(progress.at(-1)).toEqual([5, 5]);
  });

  it('não executa operação para lote vazio', async () => {
    let calls = 0;
    const result = await runAdminBatch([], async () => { calls += 1; });
    expect(calls).toBe(0);
    expect(result).toEqual({ succeeded: [], failed: [] });
  });

  it('rejeita concorrência inválida', async () => {
    await expect(runAdminBatch([1], async () => undefined, { concurrency: 0 }))
      .rejects.toThrow('Concorrência do lote precisa ser um inteiro positivo.');
  });
});

describe('summarizeAdminBatch', () => {
  it('resume sucesso total', () => {
    expect(summarizeAdminBatch('Reativação', { succeeded: [1, 2], failed: [] }))
      .toBe('Reativação: 2 itens concluídos.');
  });

  it('inclui primeira falha sem esconder sucessos', () => {
    expect(summarizeAdminBatch('Lixeira', {
      succeeded: [1],
      failed: [{ item: 2, error: 'arquivo ocupado' }]
    })).toBe('Lixeira: 1 concluído, 1 com falha. Primeira falha: arquivo ocupado');
  });
});
