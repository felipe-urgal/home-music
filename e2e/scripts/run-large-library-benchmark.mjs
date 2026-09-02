import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = fileURLToPath(new URL('../', import.meta.url));
const playwrightCli = path.join(e2eDir, 'node_modules', '@playwright', 'test', 'cli.js');
const rawSizes = process.env.HOME_MUSIC_BROWSER_BENCHMARK_TRACKS?.trim() || '10000,25000';
const rawRuns = process.env.HOME_MUSIC_BROWSER_BENCHMARK_RUNS?.trim() || '1';
const sizes = rawSizes.split(',').map(value => Number(value.trim()));
const runs = Number(rawRuns);

if (sizes.length === 0 || sizes.some(size => !Number.isInteger(size) || size < 1 || size > 50_000)) {
  throw new Error('HOME_MUSIC_BROWSER_BENCHMARK_TRACKS deve conter inteiros entre 1 e 50000 separados por vírgula.');
}
if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
  throw new Error('HOME_MUSIC_BROWSER_BENCHMARK_RUNS deve ser um inteiro entre 1 e 10.');
}

function runPlaywright(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [playwrightCli, 'test', '--config=playwright.large-library.config.ts'],
      {
        cwd: e2eDir,
        env: { ...process.env, ...env },
        stdio: 'inherit'
      }
    );

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`Playwright do benchmark foi encerrado por ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

for (const trackCount of sizes) {
  for (let run = 1; run <= runs; run += 1) {
    const memoryFile = path.join(
      tmpdir(),
      `home-music-large-library-${process.pid}-${trackCount}-${run}.json`
    );

    console.log(`\n[large-library-browser] ${trackCount} faixas · execução ${run}/${runs}`);
    try {
      const code = await runPlaywright({
        HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS: String(trackCount),
        HOME_MUSIC_E2E_MEMORY_FILE: memoryFile,
        HOME_MUSIC_BROWSER_BENCHMARK_RUN_INDEX: String(run)
      });
      if (code !== 0) process.exit(code);
    } finally {
      await rm(memoryFile, { force: true });
    }
  }
}
