import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const trackCount = Number(process.env.HOME_MUSIC_E2E_LARGE_LIBRARY_TRACKS || '10000');
const memoryFile = process.env.HOME_MUSIC_E2E_MEMORY_FILE?.trim() || '';
const runIndex = Number(process.env.HOME_MUSIC_BROWSER_BENCHMARK_RUN_INDEX || '1');
const MEBIBYTE = 1024 * 1024;

const LIMITS = trackCount <= 10_000
  ? {
      usableMs: 15_000,
      libraryDecodedMb: 8,
      libraryTransferMb: 9,
      initialBundleDecodedMb: 4,
      longTaskTotalMs: 5_000,
      longTaskMaxMs: 2_500,
      searchMs: 2_500,
      filterMs: 2_500,
      sortMs: 2_500,
      growListMs: 2_500,
      serverHeapMb: 768,
      serverRssMb: 1_536
    }
  : {
      usableMs: 25_000,
      libraryDecodedMb: 18,
      libraryTransferMb: 20,
      initialBundleDecodedMb: 4,
      longTaskTotalMs: 8_000,
      longTaskMaxMs: 4_000,
      searchMs: 4_000,
      filterMs: 4_000,
      sortMs: 4_000,
      growListMs: 4_000,
      serverHeapMb: 1_024,
      serverRssMb: 2_048
    };

type ServerMemorySnapshot = {
  pid: number;
  sampledAt: string;
  heapUsedMb: number;
  rssMb: number;
  peakHeapUsedMb: number;
  peakRssMb: number;
};

type ResourceSnapshot = {
  transferMb: number;
  encodedBodyMb: number;
  decodedBodyMb: number;
  durationMs: number;
};

function mb(bytes: number) {
  return Number((bytes / MEBIBYTE).toFixed(2));
}

function roundMs(value: number) {
  return Number(value.toFixed(2));
}

function assertWithin(label: string, actual: number, limit: number, unit: string) {
  expect(actual, `${label}: ${actual}${unit} > ${limit}${unit}`).toBeLessThanOrEqual(limit);
}

async function login(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByTestId('desktop-sidebar')).toBeVisible();
}

async function measureAction(action: () => Promise<unknown>, settled: () => Promise<unknown>) {
  const startedAt = performance.now();
  await action();
  await settled();
  return roundMs(performance.now() - startedAt);
}

async function readServerMemory(): Promise<ServerMemorySnapshot> {
  await expect.poll(async () => {
    try {
      const parsed = JSON.parse(await readFile(memoryFile, 'utf8')) as ServerMemorySnapshot;
      return parsed.peakHeapUsedMb > 0 && parsed.peakRssMb > 0;
    } catch {
      return false;
    }
  }, { timeout: 10_000 }).toBe(true);

  return JSON.parse(await readFile(memoryFile, 'utf8')) as ServerMemorySnapshot;
}

function highestFlacTitle() {
  let index = trackCount - 1;
  while (index >= 0 && index % 4 !== 2) index -= 1;
  return `Faixa ${String(index + 1).padStart(6, '0')}`;
}

test('keeps a large real-browser library within grave-regression budgets', async ({ page }) => {
  await page.addInitScript(() => {
    const state = {
      supported: false,
      durations: [] as number[]
    };
    (window as Window & { __homeMusicLongTasks?: typeof state }).__homeMusicLongTasks = state;

    try {
      state.supported = PerformanceObserver.supportedEntryTypes.includes('longtask');
      if (!state.supported) return;
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.durations.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      state.supported = false;
    }
  });

  await login(page);

  const initialBundle = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const assets = resources.filter(entry => {
      try {
        return new URL(entry.name).pathname.startsWith('/assets/');
      } catch {
        return false;
      }
    });
    return {
      resources: assets.length,
      transferBytes: assets.reduce((sum, entry) => sum + entry.transferSize, 0),
      encodedBodyBytes: assets.reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      decodedBodyBytes: assets.reduce((sum, entry) => sum + entry.decodedBodySize, 0)
    };
  });

  const usableStartedAt = performance.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const sidebar = page.getByTestId('desktop-sidebar');
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button', { name: 'Pastas', exact: true }).click();

  const search = page.getByPlaceholder('Música, artista, álbum ou pasta');
  const table = page.getByTestId('desktop-library-table');
  const rows = table.locator('tbody tr');
  await expect(search).toBeVisible();
  await expect(table).toBeVisible();
  await expect(rows).toHaveCount(100);
  const usableMs = roundMs(performance.now() - usableStartedAt);

  const libraryResource = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    const matches = resources.filter(entry => {
      try {
        return new URL(entry.name).pathname === '/api/library';
      } catch {
        return false;
      }
    });
    const entry = matches.at(-1);
    if (!entry) return null;
    return {
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      duration: entry.duration
    };
  });
  expect(libraryResource, 'Resource Timing de /api/library não foi encontrado.').not.toBeNull();
  expect(libraryResource!.decodedBodySize).toBeGreaterThan(0);

  const library: ResourceSnapshot = {
    transferMb: mb(libraryResource!.transferSize),
    encodedBodyMb: mb(libraryResource!.encodedBodySize),
    decodedBodyMb: mb(libraryResource!.decodedBodySize),
    durationMs: roundMs(libraryResource!.duration)
  };

  const searchMs = await measureAction(
    () => search.fill('Faixa 000042'),
    async () => {
      await expect(rows).toHaveCount(1);
      await expect(table.getByText('Faixa 000042', { exact: true })).toBeVisible();
    }
  );

  // Mantém uma busca ampla ativa para que a raiz de Pastas exercite o conjunto completo
  // e exponha o controle real de ordenação, sem entrar em uma subpasta artificial.
  await search.fill('Faixa');
  await expect(rows).toHaveCount(100);

  const viewToggle = page.getByRole('button', { name: 'Ordenar, filtrar e gerenciar views' });
  await viewToggle.click();
  const viewControls = page.locator('.library-view-controls');
  const formatSelect = viewControls.getByLabel('Formato');
  const sortSelect = viewControls.locator('select:has(option[value="title-desc"])');
  await expect(formatSelect).toBeVisible();
  await expect(sortSelect).toBeVisible();

  const filterMs = await measureAction(
    () => formatSelect.selectOption('FLAC'),
    async () => {
      await expect(rows).toHaveCount(100);
      await expect(rows.first().locator('.desktop-library-table__format')).toHaveText('FLAC');
      await expect(rows.last().locator('.desktop-library-table__format')).toHaveText('FLAC');
    }
  );

  const expectedFirstSortedTitle = highestFlacTitle();
  const sortMs = await measureAction(
    () => sortSelect.selectOption('title-desc'),
    async () => {
      await expect(rows.first().locator('.desktop-library-table__track-copy strong'))
        .toHaveText(expectedFirstSortedTitle);
    }
  );

  const loadMore = page.getByRole('button', { name: 'Mostrar mais', exact: true });
  await expect(loadMore).toBeVisible();
  const growListMs = await measureAction(
    () => loadMore.click(),
    () => expect(rows).toHaveCount(200)
  );

  const longTasks = await page.evaluate(() => {
    const state = (window as Window & {
      __homeMusicLongTasks?: { supported: boolean; durations: number[] };
    }).__homeMusicLongTasks;
    const durations = state?.durations || [];
    return {
      supported: Boolean(state?.supported),
      count: durations.length,
      totalMs: durations.reduce((sum, duration) => sum + duration, 0),
      maxMs: durations.length ? Math.max(...durations) : 0
    };
  });

  const browserMemory = await page.evaluate(() => {
    const memory = (performance as Performance & {
      memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    }).memory;
    if (!memory) return null;
    return {
      usedJsHeapMb: memory.usedJSHeapSize / (1024 * 1024),
      totalJsHeapMb: memory.totalJSHeapSize / (1024 * 1024),
      jsHeapLimitMb: memory.jsHeapSizeLimit / (1024 * 1024)
    };
  });

  const serverMemory = await readServerMemory();
  const bundle = {
    resources: initialBundle.resources,
    transferMb: mb(initialBundle.transferBytes),
    encodedBodyMb: mb(initialBundle.encodedBodyBytes),
    decodedBodyMb: mb(initialBundle.decodedBodyBytes)
  };

  assertWithin('tempo até biblioteca utilizável', usableMs, LIMITS.usableMs, 'ms');
  assertWithin('payload decodificado /api/library', library.decodedBodyMb, LIMITS.libraryDecodedMb, 'MiB');
  assertWithin('transferência /api/library', library.transferMb, LIMITS.libraryTransferMb, 'MiB');
  assertWithin('bundle inicial decodificado', bundle.decodedBodyMb, LIMITS.initialBundleDecodedMb, 'MiB');
  assertWithin('busca', searchMs, LIMITS.searchMs, 'ms');
  assertWithin('filtro', filterMs, LIMITS.filterMs, 'ms');
  assertWithin('ordenação', sortMs, LIMITS.sortMs, 'ms');
  assertWithin('crescimento da lista', growListMs, LIMITS.growListMs, 'ms');
  assertWithin('heap máximo do servidor', serverMemory.peakHeapUsedMb, LIMITS.serverHeapMb, 'MiB');
  assertWithin('RSS máximo do servidor', serverMemory.peakRssMb, LIMITS.serverRssMb, 'MiB');
  if (longTasks.supported) {
    assertWithin('bloqueio total por long tasks', longTasks.totalMs, LIMITS.longTaskTotalMs, 'ms');
    assertWithin('maior long task', longTasks.maxMs, LIMITS.longTaskMaxMs, 'ms');
  }

  console.log(JSON.stringify({
    benchmark: 'large-library-browser',
    runIndex,
    dataset: {
      tracks: trackCount,
      initialVisibleTracks: 100,
      grownVisibleTracks: 200
    },
    measurements: {
      usableMs,
      libraryResource: library,
      initialBundle: bundle,
      interactions: {
        searchMs,
        filterMs,
        sortMs,
        growListMs
      },
      longTasks: {
        ...longTasks,
        totalMs: roundMs(longTasks.totalMs),
        maxMs: roundMs(longTasks.maxMs)
      },
      serverMemory,
      browserMemory: browserMemory
        ? {
            usedJsHeapMb: Number(browserMemory.usedJsHeapMb.toFixed(2)),
            totalJsHeapMb: Number(browserMemory.totalJsHeapMb.toFixed(2)),
            jsHeapLimitMb: Number(browserMemory.jsHeapLimitMb.toFixed(2))
          }
        : null
    },
    regressionLimits: LIMITS
  }, null, 2));
});
