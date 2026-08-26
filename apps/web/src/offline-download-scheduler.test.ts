import { describe, expect, it } from 'vitest';
import { OfflineDownloadScheduler } from './offline-download-scheduler';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('OfflineDownloadScheduler', () => {
  it('executa até três downloads ao mesmo tempo e enfileira os demais', async () => {
    const scheduler = new OfflineDownloadScheduler(3);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: string[] = [];

    const jobs = gates.map((gate, index) => scheduler.enqueue(`track-${index}`, async () => {
      started.push(`track-${index}`);
      await gate.promise;
    }));

    await Promise.resolve();
    expect(started).toEqual(['track-0', 'track-1', 'track-2']);
    expect(scheduler.pendingIds).toEqual(new Set(['track-0', 'track-1', 'track-2', 'track-3']));

    gates[0]?.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['track-0', 'track-1', 'track-2', 'track-3']);

    gates.slice(1).forEach(gate => gate.resolve());
    await Promise.all(jobs);
    expect(scheduler.pendingIds.size).toBe(0);
  });

  it('deduplica pedidos simultâneos da mesma faixa', async () => {
    const scheduler = new OfflineDownloadScheduler(3);
    const gate = deferred();
    let executions = 0;

    const first = scheduler.enqueue('same-track', async () => {
      executions += 1;
      await gate.promise;
    });
    const second = scheduler.enqueue('same-track', async () => {
      executions += 1;
    });

    expect(second).toBe(first);
    expect(executions).toBe(1);
    gate.resolve();
    await first;
    expect(scheduler.pendingIds.size).toBe(0);
  });

  it('mantém o estado global observável enquanto o job continua ativo', async () => {
    const scheduler = new OfflineDownloadScheduler(2);
    const gate = deferred();
    const snapshots: string[][] = [];
    const unsubscribe = scheduler.subscribe(ids => snapshots.push([...ids]));

    const job = scheduler.enqueue('persistent-track', () => gate.promise);
    expect(snapshots.at(-1)).toEqual(['persistent-track']);

    unsubscribe();
    expect(scheduler.pendingIds.has('persistent-track')).toBe(true);

    gate.resolve();
    await job;
    expect(scheduler.pendingIds.size).toBe(0);
  });

  it('libera o slot e continua a fila quando uma tarefa falha sincronicamente', async () => {
    const scheduler = new OfflineDownloadScheduler(1);
    const started: string[] = [];

    const failed = scheduler.enqueue('broken-track', () => {
      started.push('broken-track');
      throw new Error('falha síncrona');
    });
    const next = scheduler.enqueue('next-track', async () => {
      started.push('next-track');
    });

    await expect(failed).rejects.toThrow('falha síncrona');
    await next;

    expect(started).toEqual(['broken-track', 'next-track']);
    expect(scheduler.pendingIds.size).toBe(0);
  });
});
