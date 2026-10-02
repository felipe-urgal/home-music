import { expect, test, type Page } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

async function loginAndOpenDjMode(page: Page) {
  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  const expandTopbar = page.getByRole('button', { name: 'Expandir barra superior' });
  if (await expandTopbar.isVisible()) await expandTopbar.click();

  await page.getByRole('button', { name: 'Abrir Modo DJ' }).click();
  const dj = page.getByRole('region', { name: 'Modo DJ' });
  await expect(dj).toBeVisible();
  return dj;
}

async function openDjLibrary(dj: ReturnType<Page['getByRole']>) {
  await dj.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const library = dj.getByRole('listbox', { name: 'Faixas' });
  await expect(library).toBeVisible();
  return library;
}

async function openDjDecks(dj: ReturnType<Page['getByRole']>) {
  await dj.getByRole('button', { name: 'DJ', exact: true }).click();
  await expect(dj.getByRole('region', { name: 'Mixer' })).toBeVisible();
}

test('Modo DJ mantém AutoMix, FX e gravação ativos no mesmo fluxo', async ({ page }) => {
  test.setTimeout(60_000);

  await page.addInitScript(() => {
    localStorage.setItem('home-music:crossfade-seconds:v2', '3');

    class E2eMediaRecorder {
      static isTypeSupported(mimeType: string) {
        return mimeType.startsWith('audio/webm');
      }

      readonly mimeType = 'audio/webm;codecs=opus';
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;

      constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

      start() {
        this.state = 'recording';
      }

      requestData() {
        if (this.state !== 'recording') return;
        this.ondataavailable?.({
          data: new Blob(['home-music-dj-performance-e2e'], { type: this.mimeType })
        } as BlobEvent);
      }

      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        queueMicrotask(() => this.onstop?.(new Event('stop')));
      }
    }

    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: E2eMediaRecorder
    });
  });

  const dj = await loginAndOpenDjMode(page);
  const library = await openDjLibrary(dj);

  const trackA = library.getByRole('option').filter({ hasText: 'E2E Track' });
  await trackA.click();
  await dj.getByRole('button', { name: 'LOAD A' }).click();

  const trackB = library.getByRole('option').filter({ hasText: 'E2E Zeta' });
  await trackB.click();
  await dj.getByRole('button', { name: 'LOAD B' }).click();

  await openDjDecks(dj);
  const mixer = page.getByRole('region', { name: 'Mixer' });
  const fxSettings = mixer.locator('details.dj-mixer-fx-settings');
  await fxSettings.locator('summary').click();
  const echoA = mixer.getByRole('button', { name: 'Echo Channel A' });
  const reverbB = mixer.getByRole('button', { name: 'Reverb Channel B' });
  await echoA.click();
  await mixer.getByRole('slider', { name: 'Echo Wet Channel A' }).fill('0.35');
  await reverbB.click();
  await mixer.getByRole('slider', { name: 'Reverb Wet Channel B' }).fill('0.25');

  const rec = dj.getByRole('button', { name: /REC/ });
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');

  const automix = dj.getByRole('button', { name: 'AutoMix' });
  await automix.click();
  await expect(automix).toHaveAttribute('aria-pressed', 'true');
  const automixLibrary = await openDjLibrary(dj);
  await expect(automixLibrary.locator('.dj-library-status-badge').filter({ hasText: 'AGORA' })).toHaveCount(1);
  await expect(automixLibrary.locator('.dj-library-status-badge').filter({ hasText: 'PRÓXIMA' })).toHaveCount(1);
  await openDjDecks(dj);
  await expect(echoA).toHaveAttribute('aria-pressed', 'true');
  await expect(reverbB).toHaveAttribute('aria-pressed', 'true');
  await expect(rec).toHaveAttribute('aria-pressed', 'true');

  const deckA = page.getByRole('article', { name: 'Deck A' });
  const deckB = page.getByRole('article', { name: 'Deck B' });
  const outgoingTitle = await deckA.locator('.dj-pro-deck__track-copy strong').innerText();
  const incomingTitle = await deckB.locator('.dj-pro-deck__track-copy strong').innerText();

  await expect.poll(async () => page.evaluate(() => {
    const audios = Array.from(document.querySelectorAll('audio'));
    const active = audios.find(audio => (
      !audio.paused
      && Number.isFinite(audio.duration)
      && audio.duration > 0
    ));
    if (!active) return false;
    active.currentTime = Math.max(0, active.duration - 2);
    return true;
  })).toBe(true);

  await expect.poll(async () => page.evaluate(() => (
    Array.from(document.querySelectorAll('audio'))
      .filter(audio => !audio.paused).length
  ))).toBeGreaterThanOrEqual(2);

  await expect(deckB.locator('.dj-pro-deck__track-copy strong')).toHaveText(incomingTitle);

  await expect(deckB).toHaveAttribute('data-playing', 'true');
  await expect(deckA).toHaveAttribute('data-playing', 'false', { timeout: 10_000 });
  await expect(deckB.locator('.dj-pro-deck__track-copy strong')).toHaveText(incomingTitle);
  await expect.poll(async () => (
    await deckA.locator('.dj-pro-deck__track-copy strong').innerText()
  )).not.toBe(outgoingTitle);
  await expect.poll(async () => (
    await deckA.locator('.dj-pro-deck__track-copy strong').innerText()
  )).not.toBe(incomingTitle);

  const downloadPromise = page.waitForEvent('download');
  await rec.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^home-music-dj-\d{8}-\d{6}\.webm$/);
  await expect(rec).toHaveAttribute('aria-pressed', 'false');

  await dj.getByRole('button', { name: 'Manual' }).click();
  await dj.getByRole('button', { name: 'Sair do modo DJ' }).click();
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
});

test('Modo DJ degrada sem Web MIDI e sem MediaRecorder sem bloquear playback', async ({ page }) => {
  test.setTimeout(60_000);

  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'MediaRecorder', {
      configurable: true,
      value: undefined
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: undefined
    });
  });

  const dj = await loginAndOpenDjMode(page);
  const rec = dj.getByRole('button', { name: 'REC N/D' });
  await expect(rec).toBeDisabled();
  await expect(rec).toHaveAttribute('title', 'Gravação não suportada neste navegador');

  const midiDrawer = page.locator('details.dj-midi-drawer');
  await midiDrawer.locator('summary').click();
  const midi = page.getByRole('region', { name: 'Controlador MIDI' });
  await expect(midi).toContainText('Web MIDI indisponível');
  await expect(midi.getByRole('button', { name: 'Conectar' })).toBeDisabled();

  const library = await openDjLibrary(dj);
  const track = library.getByRole('option').filter({ hasText: 'E2E Track' });
  await track.click();
  await dj.getByRole('button', { name: 'LOAD A' }).click();

  await openDjDecks(dj);
  const deckA = page.getByRole('article', { name: 'Deck A' });
  await expect(deckA).toContainText('E2E Track');
  await deckA.getByRole('button', { name: 'Reproduzir Deck A' }).click();
  await expect(deckA.getByRole('button', { name: 'Pausar Deck A' })).toBeVisible();

  await dj.getByRole('button', { name: 'Sair do modo DJ' }).click();
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
});
