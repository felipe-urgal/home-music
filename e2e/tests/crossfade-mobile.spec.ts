import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';
const crossfadeStorageKey = 'home-music:crossfade-seconds:v2';

async function login(page: Page, expectedTrack: string | null = 'E2E Track') {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('.player-screen-immersive')).toBeVisible();
  if (expectedTrack) {
    await expect(page.getByRole('heading', { name: expectedTrack })).toBeVisible();
  }
}

test('crossfade mistura dois decks reais no Chromium mobile e faz handoff sem reiniciar a próxima faixa', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await page.addInitScript(({ storageKey }) => {
    window.localStorage.setItem(storageKey, '2');
  }, { storageKey: crossfadeStorageKey });

  await login(page);
  await expect(page.locator('audio')).toHaveCount(2);

  const artworkPlay = page.locator('.player-hero-play__control');
  await expect(artworkPlay).toHaveAttribute('aria-label', 'Tocar');
  await artworkPlay.click();
  await expect(artworkPlay).toHaveAttribute('aria-label', 'Pausar');

  await expect.poll(async () => page.evaluate(() => {
    const playingDecks = Array.from(document.querySelectorAll('audio'))
      .filter(audio => !audio.paused && !audio.ended && audio.currentTime > 0);

    return playingDecks.length === 2
      && playingDecks.every(audio => audio.volume > 0 && audio.volume < 1);
  }), { timeout: 12_000, intervals: [200, 400] }).toBe(true);

  const visualTransition = page.locator('.now-playing-transition-art[data-crossfading="true"]');
  await expect(visualTransition).toHaveAttribute('data-crossfade-incoming-title', 'E2E Zeta');
  await expect(page.locator('.now-playing-transition-copy[data-crossfading="true"]'))
    .toHaveAttribute('data-crossfade-incoming-title', 'E2E Zeta');
  await expect.poll(async () => {
    const value = Number(await visualTransition.getAttribute('data-crossfade-progress'));
    return value > 0 && value < 1;
  }).toBe(true);

  const incomingPositionDuringMix = await page.evaluate(() => {
    const audios = Array.from(document.querySelectorAll('audio'));
    return Math.min(...audios
      .filter(audio => !audio.paused && audio.currentTime > 0)
      .map(audio => audio.currentTime));
  });
  expect(incomingPositionDuringMix).toBeGreaterThan(0);

  await expect(page.getByRole('heading', { name: 'E2E Zeta' })).toBeVisible({ timeout: 5_000 });

  await expect.poll(async () => page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .filter(audio => !audio.paused && !audio.ended && audio.currentTime > 0)
      .length
  )), { timeout: 2_000 }).toBe(1);

  const adoptedPosition = await page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .find(audio => !audio.paused && !audio.ended)?.currentTime ?? 0
  ));
  expect(adoptedPosition).toBeGreaterThan(0.25);
});


test('crossfade quantizado inicia próximo da batida planejada no Chromium mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');

  await page.addInitScript(({ storageKey }) => {
    window.localStorage.setItem(storageKey, '2');
  }, { storageKey: crossfadeStorageKey });

  await page.route('**/api/library', async route => {
    const response = await route.fetch();
    const body = await response.json() as {
      tracks: Array<Record<string, unknown> & { title?: string }>;
      [key: string]: unknown;
    };

    await route.fulfill({
      response,
      json: {
        ...body,
        tracks: body.tracks.map(track => (
          track.title === 'E2E Track'
            ? {
                ...track,
                rhythm: {
                  bpm: 60,
                  firstBeatSeconds: 0.75,
                  confidence: 0.95
                }
              }
            : track
        ))
      }
    });
  });

  const loginResponse = await page.context().request.post('/api/auth/login', {
    headers: { 'X-Home-Music-Request': '1' },
    data: { username, password }
  });
  expect(loginResponse.ok()).toBe(true);

  const libraryResponse = await page.context().request.get('/api/library');
  expect(libraryResponse.ok()).toBe(true);
  const library = await libraryResponse.json() as {
    tracks: Array<{ id: string; title: string }>;
  };
  const trackId = library.tracks.find(track => track.title === 'E2E Track')?.id;
  const zetaId = library.tracks.find(track => track.title === 'E2E Zeta')?.id;
  const zuluId = library.tracks.find(track => track.title === 'E2E Zulu')?.id;
  expect(trackId).toBeTruthy();
  expect(zetaId).toBeTruthy();
  expect(zuluId).toBeTruthy();
  const queueIds = [trackId!, zetaId!, zuluId!];

  const resetResponse = await page.context().request.put('/api/player/state', {
    headers: { 'X-Home-Music-Request': '1' },
    data: {
      currentTrackId: trackId,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueueIds: queueIds,
      queueIds
    }
  });
  expect(resetResponse.ok()).toBe(true);

  await page.goto('/');
  await expect(page.locator('.player-screen-immersive')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  await page.evaluate(() => {
    const state = window as Window & { __e2eRhythmCrossfadeStart?: number };
    state.__e2eRhythmCrossfadeStart = undefined;

    const captureStart = () => {
      const visual = document.querySelector('.now-playing-transition-art');
      if (visual?.getAttribute('data-crossfading') !== 'true') return false;

      const playingTimes = Array.from(document.querySelectorAll('audio'))
        .filter(audio => !audio.paused && !audio.ended)
        .map(audio => audio.currentTime);
      if (playingTimes.length < 2) return false;

      state.__e2eRhythmCrossfadeStart = Math.max(...playingTimes);
      return true;
    };

    const observer = new MutationObserver(() => {
      if (captureStart()) observer.disconnect();
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-crossfading', 'data-crossfade-progress']
    });
    captureStart();
  });

  const artworkPlay = page.locator('.player-hero-play__control');
  if (await artworkPlay.getAttribute('aria-label') === 'Tocar') {
    await artworkPlay.click();
  }
  await expect(artworkPlay).toHaveAttribute('aria-label', 'Pausar');

  await page.waitForFunction(() => Number.isFinite(
    (window as Window & { __e2eRhythmCrossfadeStart?: number }).__e2eRhythmCrossfadeStart
  ), undefined, { timeout: 12_000, polling: 50 });

  const outgoingTimeAtMix = await page.evaluate(() => (
    (window as Window & { __e2eRhythmCrossfadeStart?: number }).__e2eRhythmCrossfadeStart ?? 0
  ));

  // Faixa de 10 s, crossfade preferido de 2 s => alvo bruto em 8,00 s.
  // Com 60 BPM e primeira batida em 0,75 s, a próxima fronteira é 8,75 s.
  // Um início não quantizado em ~8,00 s ou atrasado para ~9,70 s fica fora.
  expect(outgoingTimeAtMix).toBeGreaterThanOrEqual(8.65);
  expect(outgoingTimeAtMix).toBeLessThan(9.10);

  await expect(page.locator('.now-playing-transition-art[data-crossfading="true"]'))
    .toHaveAttribute('data-crossfade-incoming-title', 'E2E Zeta');
});
