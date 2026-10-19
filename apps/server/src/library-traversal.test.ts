import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { scanLibrary } from './library.js';
import { resolveLibraryRoot } from './security.js';

test('benchmark rastreável: biblioteca plana vs muito aninhada preserva ordem, limites e confinamento', async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'hm-scanner-traversal-'));
  const count = 160;
  try {
    const flat = path.join(temp, 'flat');
    const nested = path.join(temp, 'nested');
    const deep = path.join(nested, ...Array.from({ length: 18 }, (_, index) =>
      `level-${String(index).padStart(2, '0')}`
    ));
    await mkdir(flat, { recursive: true });
    await mkdir(deep, { recursive: true });

    for (let index = 0; index < count; index += 1) {
      const name = `track-${String(index).padStart(4, '0')}.mp3`;
      await Promise.all([
        writeFile(path.join(flat, name), `bytes:${index}`),
        writeFile(path.join(deep, name), `bytes:${index}`)
      ]);
    }
    // Symbols pointing outside MUSIC_DIR must never appear in the indexed snapshot.
    const outside = path.join(temp, 'private.mp3');
    await writeFile(outside, 'fora da biblioteca');
    await symlink(outside, path.join(nested, 'escaped.mp3'));
    await symlink(temp, path.join(nested, 'escaped-dir'), 'dir');

    const measure = async (root: string) => {
      const libraryRoot = await resolveLibraryRoot(root);
      const started = performance.now();
      const initial = await scanLibrary(libraryRoot);
      const coldMs = performance.now() - started;
      assert.equal(initial.tracks.length, count);
      assert.equal(initial.stats.added, count);
      assert.equal(initial.incomplete, false);
      const names = initial.tracks.map(track => track.title);
      assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'pt-BR')));
      assert.ok(initial.tracks.every(track => track.filePath.startsWith(libraryRoot + path.sep)));
      let previous = initial.tracks;
      const warm: number[] = [];
      for (let iteration = 0; iteration < 3; iteration++) {
        const start = performance.now();
        const result = await scanLibrary(libraryRoot, previous);
        warm.push(performance.now() - start);
        assert.deepEqual(result.stats, { added: 0, updated: 0, removed: 0, unchanged: count });
        assert.deepEqual(result.delta, { added: [], updated: [], removedIds: [] });
        previous = result.tracks;
      }
      warm.sort((a, b) => a - b);
      return { coldMs: Math.round(coldMs), warmMedianMs: Math.round(warm[1]), tracks: count };
    };

    const flatMetrics = await measure(flat);
    const deepMetrics = await measure(nested);
    t.diagnostic(JSON.stringify({
      workload: { tracks: count, levels: 18, metadataConcurrencyMaximum: 8 },
      flat: flatMetrics, nested: deepMetrics,
      warmRatio: Number((deepMetrics.warmMedianMs / Math.max(1, flatMetrics.warmMedianMs)).toFixed(2))
    }));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
