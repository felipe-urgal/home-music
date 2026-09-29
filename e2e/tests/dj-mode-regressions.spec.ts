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
    const sentMidi: number[][] = [];
    const sentMidiSecondary: number[][] = [];
    const output = {
      id: 'e2e-ddj-output',
      name: 'E2E DDJ-400 OUT',
      manufacturer: 'E2E',
      state: 'connected',
      type: 'output',
      send: (data: number[] | Uint8Array) => {
        sentMidi.push(Array.from(data));
      }
    };
    const secondaryOutput = {
      id: 'e2e-ddj-output-secondary',
      name: 'E2E DDJ-400 OUT 2',
      manufacturer: 'E2E',
      state: 'connected',
      type: 'output',
      send: (data: number[] | Uint8Array) => {
        sentMidiSecondary.push(Array.from(data));
      }
    };
    const access = {
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output], [secondaryOutput.id, secondaryOutput]]),
      onstatechange: null
    };

    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => access
    });
    Object.assign(globalThis, {
      __homeMusicE2eMidiInput: input,
      __homeMusicE2eMidiAccess: access,
      __homeMusicE2eMidiOutputMessages: sentMidi,
      __homeMusicE2eMidiSecondaryOutputMessages: sentMidiSecondary
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

  const tempoA = deckA.getByLabel('Tempo Deck A');
  await expect(tempoA).toBeVisible();
  await tempoA.fill('1.03');
  await expect(deckA).toContainText('Rate1.030×');
  await expect(deckA).toContainText('Pitch+3.00%');
  await tempoA.fill('1');
  await expect(deckA).toContainText('Rate1.000×');
  await expect(deckA.getByRole('button', { name: 'Jog wheel Deck A' })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'IN', exact: true })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'OUT', exact: true })).toBeDisabled();

  const autoLoopA = deckA.getByRole('button', { name: 'Auto Loop 4 beats Deck A' });
  await expect(autoLoopA).toHaveAttribute('aria-pressed', 'false');
  await autoLoopA.click();
  await expect(autoLoopA).toHaveAttribute('aria-pressed', 'true');
  const loopRangeA = deckA.locator('.dj-waveform__loop-range');
  await expect(loopRangeA).toHaveCount(1);
  await expect(loopRangeA).toHaveAttribute('data-active', 'true');
  await expect(deckA.getByRole('button', { name: 'OUT', exact: true })).toBeEnabled();
  await autoLoopA.click();
  await expect(autoLoopA).toHaveAttribute('aria-pressed', 'false');
  await expect(loopRangeA).toHaveAttribute('data-active', 'false');
  await autoLoopA.click();
  await expect(autoLoopA).toHaveAttribute('aria-pressed', 'true');

  const existingHotCueClear = deckA.getByRole('button', { name: 'Limpar Hot Cue 1 Deck A' });
  if (await existingHotCueClear.isEnabled().catch(() => false)) {
    const resetHotCue = page.waitForResponse(response => (
      response.url().includes('/api/tracks/')
      && response.url().endsWith('/hot-cues')
      && response.request().method() === 'PUT'
    ));
    await existingHotCueClear.click();
    expect((await resetHotCue).ok()).toBe(true);
  }

  await expect(deckA.getByRole('button', { name: 'Definir Hot Cue 1 Deck A' })).toBeVisible();
  const quantizeA = deckA.getByRole('button', { name: 'QUANTIZE Hot Cues Deck A' });
  await expect(quantizeA).toHaveAttribute('aria-pressed', 'false');
  await quantizeA.click();
  await expect(quantizeA).toHaveAttribute('aria-pressed', 'true');

  const saveHotCueRequest = page.waitForRequest(request => (
    request.url().includes('/api/tracks/')
    && request.url().endsWith('/hot-cues')
    && request.method() === 'PUT'
  ));
  const saveHotCue = page.waitForResponse(response => (
    response.url().includes('/api/tracks/')
    && response.url().endsWith('/hot-cues')
    && response.request().method() === 'PUT'
  ));
  await deckA.getByRole('button', { name: 'Definir Hot Cue 1 Deck A' }).click();
  const persistedHotCue = (await saveHotCueRequest).postDataJSON() as {
    version: number;
    positions: Array<number | null>;
  };
  expect(persistedHotCue.version).toBe(1);
  expect(persistedHotCue.positions).toHaveLength(4);
  expect(typeof persistedHotCue.positions[0]).toBe('number');
  expect((await saveHotCue).ok()).toBe(true);
  await expect(deckA.getByRole('button', { name: 'Ir para Hot Cue 1 Deck A' })).toBeVisible();
  const waveformHotCueA = deckA.getByRole('button', { name: 'Hot Cue 1 no waveform Deck A' });
  await expect(waveformHotCueA).toBeVisible();
  await waveformHotCueA.click();
  await deckA.getByRole('button', { name: 'Ir para Hot Cue 1 Deck A' }).click();

  await dj.getByRole('button', { name: 'LOAD B' }).click();
  await expect(deckB).toContainText('E2E Track');
  await expect(deckB.getByRole('button', { name: 'Ir para Hot Cue 1 Deck B' })).toBeVisible();
  await expect(deckB.getByRole('button', { name: 'Hot Cue 1 no waveform Deck B' })).toBeVisible();

  const clearHotCue = page.waitForResponse(response => (
    response.url().includes('/api/tracks/')
    && response.url().endsWith('/hot-cues')
    && response.request().method() === 'PUT'
  ));
  await deckB.getByRole('button', { name: 'Limpar Hot Cue 1 Deck B' }).click();
  expect((await clearHotCue).ok()).toBe(true);
  await expect(deckA.getByRole('button', { name: 'Definir Hot Cue 1 Deck A' })).toBeVisible();
  await expect(deckB.getByRole('button', { name: 'Definir Hot Cue 1 Deck B' })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'Hot Cue 1 no waveform Deck A' })).toHaveCount(0);
  await expect(deckB.getByRole('button', { name: 'Hot Cue 1 no waveform Deck B' })).toHaveCount(0);

  await library.getByRole('option').filter({ hasText: 'E2E Zeta' }).click();
  await dj.getByRole('button', { name: 'LOAD B' }).click();
  await expect(deckB).toContainText('E2E Zeta');
  await expect(deckB.getByRole('button', { name: 'Reproduzir Deck B' })).toBeVisible();
  await expect(deckB.getByRole('button', { name: 'Definir Hot Cue 1 Deck B' })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'Definir Hot Cue 1 Deck A' })).toBeVisible();

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

  const options = library.getByRole('option');
  await options.nth(0).click();
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({ data: [0xb6, 0x40, 0x01], receivedTime: performance.now() });
  });
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({ data: [0x96, 0x47, 0x7f], receivedTime: performance.now() });
    input?.onmidimessage?.({ data: [0x96, 0x47, 0x00], receivedTime: performance.now() });
  });
  await expect(deckB).toContainText('E2E Zeta');

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({ data: [0xb6, 0x40, 0x7f], receivedTime: performance.now() });
  });
  await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({ data: [0x96, 0x46, 0x7f], receivedTime: performance.now() });
    input?.onmidimessage?.({ data: [0x96, 0x46, 0x00], receivedTime: performance.now() });
  });
  await expect(deckA).toContainText('E2E Track');

  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.length ?? 0
  ))).toBeGreaterThanOrEqual(6);

  await deckA.getByRole('button', { name: 'Reproduzir Deck A' }).click();
  await expect(deckA.getByRole('button', { name: 'Pausar Deck A' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.some(message => (
        message[0] === 0x90 && message[1] === 0x0b && message[2] === 0x7f
      )) ?? false
  ))).toBe(true);

  await deckA.getByRole('button', { name: 'Pausar Deck A' }).click();
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.some(message => (
        message[0] === 0x90 && message[1] === 0x0b && message[2] === 0x00
      )) ?? false
  ))).toBe(true);

  await deckA.getByRole('button', { name: 'CUE', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.some(message => (
        message[0] === 0x90 && message[1] === 0x0c && message[2] === 0x7f
      )) ?? false
  ))).toBe(true);

  const primaryMessagesBeforeOutputSwitch = await page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.length ?? 0
  ));

  await midi.getByLabel('Saída').selectOption('e2e-ddj-output-secondary');

  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.length ?? 0
  ))).toBeGreaterThanOrEqual(primaryMessagesBeforeOutputSwitch + 6);

  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiSecondaryOutputMessages?: number[][] })
      .__homeMusicE2eMidiSecondaryOutputMessages?.length ?? 0
  ))).toBeGreaterThanOrEqual(6);

  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiSecondaryOutputMessages?: number[][] })
      .__homeMusicE2eMidiSecondaryOutputMessages?.some(message => (
        message[0] === 0x90 && message[1] === 0x0c && message[2] === 0x7f
      )) ?? false
  ))).toBe(true);

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({
      data: [0xb0, 0x20, 0x00],
      receivedTime: performance.now()
    });
    input?.onmidimessage?.({
      data: [0xb0, 0x00, 0x00],
      receivedTime: performance.now()
    });
  });

  await expect(deckA).toContainText('Rate1.060×');
  await expect(deckA).toContainText('Pitch+6.00%');

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({
      data: [0xb0, 0x20, 0x00],
      receivedTime: performance.now()
    });
    input?.onmidimessage?.({
      data: [0xb0, 0x00, 0x40],
      receivedTime: performance.now()
    });
  });

  await expect(deckA).toContainText('Rate1.000×');

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

  const cueBMessagesBefore = await page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiSecondaryOutputMessages?: number[][] })
      .__homeMusicE2eMidiSecondaryOutputMessages?.filter(message => (
        message[0] === 0x91 && message[1] === 0x0c && message[2] === 0x7f
      )).length ?? 0
  ));

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({ data: [0x91, 0x0c, 0x7f], receivedTime: performance.now() });
    input?.onmidimessage?.({ data: [0x91, 0x0c, 0x00], receivedTime: performance.now() });
  });

  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiSecondaryOutputMessages?: number[][] })
      .__homeMusicE2eMidiSecondaryOutputMessages?.filter(message => (
        message[0] === 0x91 && message[1] === 0x0c && message[2] === 0x7f
      )).length ?? 0
  ))).toBe(cueBMessagesBefore + 1);
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

  const messagesBeforeReconnect = await page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.length ?? 0
  ));

  await midi.getByRole('button', { name: 'Desconectar' }).click();
  await expect(midi).toContainText('Desconectado');

  await midi.getByRole('button', { name: 'Conectar' }).click();
  await expect(midi).toContainText('Conectado');
  await midi.getByLabel('Entrada').selectOption('e2e-ddj-input');
  await midi.getByLabel('Saída').selectOption('e2e-ddj-output');

  await expect.poll(async () => page.evaluate(() => (
    (globalThis as typeof globalThis & { __homeMusicE2eMidiOutputMessages?: number[][] })
      .__homeMusicE2eMidiOutputMessages?.length ?? 0
  ))).toBeGreaterThan(messagesBeforeReconnect);
  await expect(deckA).toContainText('E2E Track');
  await expect(deckB).toContainText('E2E Zeta');

  await dj.getByRole('button', { name: 'AutoMix' }).click();
  await expect(dj.getByRole('button', { name: 'AutoMix' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="a"] strong')).toHaveText('100%');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="b"] strong')).toHaveText('100%');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('A 100%');

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
