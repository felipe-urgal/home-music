import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const webRoot = fileURLToPath(new URL('../', import.meta.url));
const assetsDir = path.join(webRoot, 'dist', 'assets');
const KIB = 1024;

const BUDGETS = {
  entry: { gzip: 768 * KIB, brotli: 640 * KIB },
  administration: { gzip: 512 * KIB, brotli: 448 * KIB },
  account: { gzip: 256 * KIB, brotli: 224 * KIB },
  offline: { gzip: 384 * KIB, brotli: 320 * KIB }
};

function matchSingle(files, pattern, label) {
  const matches = files.filter(file => pattern.test(file));
  if (matches.length !== 1) {
    throw new Error(`${label}: esperado exatamente 1 chunk, encontrados ${matches.length}: ${matches.join(', ') || 'nenhum'}`);
  }
  return matches[0];
}

function compressedBytes(buffer) {
  return {
    raw: buffer.byteLength,
    gzip: gzipSync(buffer, { level: 6 }).byteLength,
    brotli: brotliCompressSync(buffer, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 4 }
    }).byteLength
  };
}

function kib(bytes) {
  return Number((bytes / KIB).toFixed(1));
}

function assertBudget(label, sizes, budget) {
  if (sizes.gzip > budget.gzip) {
    throw new Error(`${label}: gzip ${kib(sizes.gzip)} KiB excede budget ${kib(budget.gzip)} KiB`);
  }
  if (sizes.brotli > budget.brotli) {
    throw new Error(`${label}: brotli ${kib(sizes.brotli)} KiB excede budget ${kib(budget.brotli)} KiB`);
  }
}

const files = await readdir(assetsDir);
const jsFiles = files.filter(file => file.endsWith('.js'));
const targets = {
  entry: matchSingle(jsFiles, /^index-[^.]+\.js$/, 'entrypoint'),
  administration: matchSingle(jsFiles, /^AdministrationScreen-[^.]+\.js$/, 'Administração lazy'),
  account: matchSingle(jsFiles, /^MyAccountScreen-[^.]+\.js$/, 'Minha conta lazy'),
  offline: matchSingle(jsFiles, /^OfflineApp-[^.]+\.js$/, 'Modo offline lazy')
};

const report = {};
for (const [label, filename] of Object.entries(targets)) {
  const sizes = compressedBytes(await readFile(path.join(assetsDir, filename)));
  assertBudget(label, sizes, BUDGETS[label]);
  report[label] = {
    file: filename,
    rawKiB: kib(sizes.raw),
    gzipKiB: kib(sizes.gzip),
    brotliKiB: kib(sizes.brotli),
    budgetGzipKiB: kib(BUDGETS[label].gzip),
    budgetBrotliKiB: kib(BUDGETS[label].brotli)
  };
}

const deferred = {
  gzipKiB: Number((report.administration.gzipKiB + report.account.gzipKiB + report.offline.gzipKiB).toFixed(1)),
  brotliKiB: Number((report.administration.brotliKiB + report.account.brotliKiB + report.offline.brotliKiB).toFixed(1))
};

console.log('Home Music — frontend bundle budget');
console.log(JSON.stringify({ ...report, deferred }, null, 2));
console.log(`::notice title=Frontend bundle budget::entry gzip=${report.entry.gzipKiB}KiB br=${report.entry.brotliKiB}KiB; deferred gzip=${deferred.gzipKiB}KiB br=${deferred.brotliKiB}KiB; admin=${report.administration.gzipKiB}KiB; account=${report.account.gzipKiB}KiB; offline=${report.offline.gzipKiB}KiB`);
