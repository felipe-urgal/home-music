import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('Modo DJ permanece sincronizado com engine, mixer e MIDI simulado sem regredir player normal', async ({ page }) => {
  test.setTimeout(120_000);

  await page.addInitScript(() => {
    const input = {
      id: 'e2e-ddj-input',
      name: 'E2E DDJ-400',
      manufacturer: 'E2E',
      state: 'connected',
      type: 'input',
      onmidimessage: null
    };
    const output = {
      id: 'e2e-ddj-output',
      name: 'E2E DDJ-400 OUT',
      manufacturer: 'E2E',
      state: 'connected',
      type: 'output',
      send: () => undefined
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null
    };

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => access
    });
    Object.assign(globalThis, {
      __homeMusicE2eMidiInput: input,
      __homeMusicE2eMidiAccess: access
    });
  });

  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  const normalPlayer = page.locator('.desktop-now-playing-screen');
  await expect(normalPlayer.getByRole('heading', { name: 'E2E Track' })).toBeVisible();

  const expandTopbar = page.getByRole('button', { name: 'Expandir barra superior' });
  if (await expandTopbar.isVisible()) await expandTopbar.click();

  await page.getByRole('button', { name: 'Abrir Modo DJ' }).click();

  const dj = page.getByRole('region', { name: 'Modo DJ' });
  await expect(dj).toBeVisible();
  await expect(page.locator('.desktop-now-playing-screen')).toHaveCount(0);

  const deckA = page.getByRole('article', { name: 'Deck A' });
  const deckB = page.getByRole('article', { name: 'Deck B' });
  const mixer = page.getByRole('region', { name: 'Mixer' });
  const midi = page.getByRole('region', { name: 'Controlador MIDI' });
  const library = page.getByRole('listbox', { name: 'Faixas' });

  await expect(deckA).toContainText('Nenhuma faixa carregada');
  await expect(deckB).toContainText('Nenhuma faixa carregada');
  await expect(mixer).toBeVisible();
  await expect(midi).toBeVisible();
  await expect(library.getByRole('option')).toHaveCount(3);

  await library.getByRole('option').filter({ hasText: 'E2E Track' }).click();
  await dj.getByRole('button', { name: 'LOAD A' }).click();
  await expect(deckA).toContainText('E2E Track');
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();

  await library.getByRole('option').filter({ hasText: 'E2E Zeta' }).click();
  await dj.getByRole('button', { name: 'LOAD B' }).click();
  await expect(deckB).toContainText('E2E Zeta');
  await expect(deckB.getByRole('button', { name: 'Reproduzir Deck B' })).toBeVisible();

  await deckA.getByRole('button', { name: 'Reproduzir Deck A' }).click();
  await expect(deckA.getByRole('button', { name: 'Pausar Deck A' })).toBeVisible();
  await expect(deckB.getByRole('button', { name: 'Reproduzir Deck B' })).toBeVisible();
  await deckA.getByRole('button', { name: 'Pausar Deck A' }).click();
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();

  await deckB.getByRole('button', { name: 'Reproduzir Deck B' }).click();
  await expect(deckB.getByRole('button', { name: 'Pausar Deck B' })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();
  await deckB.getByRole('button', { name: 'Pausar Deck B' }).click();
  await expect(deckB.getByRole('button', { name: 'Reproduzir Deck B' })).toBeVisible();

  const channelA = mixer.locator('.dj-pro-mixer__channel[data-deck="a"] input');
  const channelB = mixer.locator('.dj-pro-mixer__channel[data-deck="b"] input');
  const crossfader = mixer.locator('.dj-pro-mixer__crossfader input');

  await channelA.fill('0.42');
  await channelB.fill('0.73');
  await crossfader.fill('-1');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="a"] strong')).toHaveText('42%');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="b"] strong')).toHaveText('73%');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('A 100%');

  await midi.getByRole('button', { name: 'Conectar' }).click();
  await expect(midi).toContainText('Conectado');
  await midi.getByLabel('Entrada').selectOption('e2e-ddj-input');
  await midi.getByLabel('Saída').selectOption('e2e-ddj-output');

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({
      data: [0x90, 0x0b, 0x7f],
      receivedTime: performance.now()
    });
  });

  await expect(deckA.getByRole('button', { name: 'Pausar Deck A' })).toBeVisible();

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({
      data: [0x90, 0x0b, 0x00],
      receivedTime: performance.now()
    });
  });
  await expect(deckA.getByRole('button', { name: 'Pausar Deck A' })).toBeVisible();

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({
      data: [0x90, 0x0b, 0x7f],
      receivedTime: performance.now()
    });
  });
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();

  await midi.getByRole('button', { name: 'Desconectar' }).click();
  await expect(midi).toContainText('Desconectado');
  await expect(deckA).toContainText('E2E Track');
  await expect(deckB).toContainText('E2E Zeta');

  await dj.getByRole('button', { name: 'AutoMix' }).click();
  await expect(dj.getByRole('button', { name: 'AutoMix' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="a"] strong')).toHaveText('100%');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="b"] strong')).toHaveText('100%');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('Centro');

  await dj.getByRole('button', { name: 'Manual' }).click();
  await expect(dj.getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');

  await channelA.fill('0.31');
  await channelB.fill('0.64');
  await crossfader.fill('1');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="a"] strong')).toHaveText('31%');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="b"] strong')).toHaveText('64%');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('B 100%');

  await dj.getByRole('button', { name: 'Sair do modo DJ' }).click();
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  await expect(page.locator('.desktop-now-playing-screen').getByRole('heading', { name: 'E2E Track' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Modo DJ' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Mixer' })).toHaveCount(0);
});
