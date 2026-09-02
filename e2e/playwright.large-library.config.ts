import { defineConfig } from '@playwright/test';

const port = 8791;
const baseURL = `http://127.0.0.1:${port}`;
const trackCount = Number(process.env.HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS || '10000');
const memoryFile = process.env.HOME_MUSIC_E2E_MEMORY_FILE?.trim();

if (!Number.isInteger(trackCount) || trackCount < 1 || trackCount > 50_000) {
  throw new Error('HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS inválido para o benchmark Playwright.');
}
if (!memoryFile) {
  throw new Error('HOME_MUSIC_E2E_MEMORY_FILE é obrigatório para medir memória do servidor.');
}

export default defineConfig({
  testDir: './benchmarks',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: {
    timeout: 30_000
  },
  reporter: 'line',
  outputDir: `test-results/large-library-${trackCount}`,
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node scripts/start-server.mjs',
    url: `${baseURL}/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS: String(trackCount),
      HOME_MUSIC_E2E_MEMORY_FILE: memoryFile
    }
  },
  projects: [
    {
      name: `desktop-chromium-${trackCount}`
    }
  ]
});
