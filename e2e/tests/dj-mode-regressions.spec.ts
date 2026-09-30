import { expect, test } from '@playwright/test';

const username = 'playwright';
const password = 'playwright-password-2026';

test('Modo DJ permanece sincronizado com engine, mixer e MIDI simulado sem regredir player normal', async ({ page }) => {
  test.setTimeout(180_000);

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
  const midiDrawer = page.locator('details.dj-midi-drawer');
  const library = page.getByRole('listbox', { name: 'Faixas' });

  await expect(deckA).toContainText('Nenhuma faixa carregada');
  await expect(deckB).toContainText('Nenhuma faixa carregada');
  await expect(mixer).toBeVisible();
  await expect(midiDrawer).toBeVisible();
  await expect(dj.locator('.dj-mode__header details.dj-midi-drawer--header')).toHaveCount(1);
  await expect(midiDrawer).not.toHaveAttribute('open', '');
  await expect(library.getByRole('option')).toHaveCount(3);
  await expect.poll(async () => library.evaluate(element => getComputedStyle(element).overflowY)).toBe('auto');

  const selectedE2eTrack = library.getByRole('option').filter({ hasText: 'E2E Track' });
  await selectedE2eTrack.click();
  const shuffleButton = dj.getByRole('button', { name: 'Aleatório' });
  await shuffleButton.click();
  await expect(shuffleButton).toHaveAttribute('aria-pressed', 'true');
  await expect(selectedE2eTrack).toHaveAttribute('aria-selected', 'true');
  await shuffleButton.click();
  await expect(shuffleButton).toHaveAttribute('aria-pressed', 'false');
  await expect(selectedE2eTrack).toHaveAttribute('aria-selected', 'true');

  await dj.getByRole('button', { name: 'LOAD A' }).click();
  await expect(deckA).toContainText('E2E Track');
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();
  await expect(selectedE2eTrack.locator('.dj-library-deck-badge[data-deck="a"]')).toHaveText('A');

  const waveformA = deckA.getByRole('slider', { name: 'Buscar posição no waveform Deck A' });
  await expect(waveformA).toBeVisible();
  await waveformA.focus();
  await page.keyboard.press('End');
  await expect.poll(async () => Number(await waveformA.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  await page.keyboard.press('Home');
  await expect.poll(async () => Number(await waveformA.getAttribute('aria-valuenow'))).toBeLessThan(0.1);

  await page.keyboard.press('1');
  await expect(deckA.getByRole('button', { name: 'Pausar Deck A' })).toBeVisible();
  await expect(selectedE2eTrack).toHaveAttribute('aria-selected', 'true');
  await expect(library.getByRole('option').last()).toContainText('E2E Track');
  await page.keyboard.press('1');
  await expect(deckA.getByRole('button', { name: 'Reproduzir Deck A' })).toBeVisible();

  const keyboardOptions = library.getByRole('option');
  await keyboardOptions.nth(0).click();
  await expect(keyboardOptions.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(keyboardOptions.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(keyboardOptions.nth(0)).toHaveAttribute('aria-selected', 'true');

  const librarySearch = dj.getByRole('textbox', { name: 'Buscar na biblioteca' });
  await librarySearch.focus();
  await page.keyboard.press('2');
  await expect(deckB).toContainText('Nenhuma faixa carregada');
  await librarySearch.fill('');
  await page.locator('body').click({ position: { x: 1, y: 1 } });

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
  await expect(autoLoopA).toBeDisabled();
  await expect(autoLoopA).toHaveAttribute('title', 'Auto Loop requer BPM analisado');
  await expect(deckA.locator('.dj-waveform__loop-range')).toHaveCount(0);

  const hotCueOneA = deckA.locator('.dj-hot-cue').first();
  const hotCueOptionsA = hotCueOneA.locator('summary');
  const existingHotCueClear = hotCueOneA.locator('.dj-hot-cue__clear');
  if (await existingHotCueClear.isEnabled().catch(() => false)) {
    await hotCueOptionsA.click();
    const resetHotCue = page.waitForResponse(response => (
      response.url().includes('/api/tracks/')
      && response.url().endsWith('/hot-cues')
      && response.request().method() === 'PUT'
    ));
    await existingHotCueClear.click();
    expect((await resetHotCue).ok()).toBe(true);
    await hotCueOptionsA.click();
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
  const hotLoopA = hotCueOneA.locator('.dj-hot-cue__loop');
  await expect(hotLoopA).toBeDisabled();
  await expect(hotLoopA).toHaveAttribute('aria-label', 'Hot Loop Hot Cue 1 Deck A');
  await expect(hotLoopA).toHaveAttribute('title', 'Hot Loop requer BPM analisado');

  const waveformHotCueA = deckA.getByRole('button', { name: 'Hot Cue 1 no waveform Deck A' });
  await expect(waveformHotCueA).toBeVisible();
  await waveformHotCueA.click();
  await deckA.getByRole('button', { name: 'Ir para Hot Cue 1 Deck A' }).click();

  await selectedE2eTrack.click();
  await expect(selectedE2eTrack).toHaveAttribute('aria-selected', 'true');
  await dj.getByRole('button', { name: 'LOAD B' }).click();
  await expect(deckB).toContainText('E2E Track');
  await expect(deckB.getByRole('button', { name: 'Ir para Hot Cue 1 Deck B' })).toBeVisible();
  await expect(deckB.getByRole('button', { name: 'Hot Cue 1 no waveform Deck B' })).toBeVisible();

  await deckB.locator('.dj-hot-cue').first().locator('summary').click();
  const clearHotCue = page.waitForResponse(response => (
    response.url().includes('/api/tracks/')
    && response.url().endsWith('/hot-cues')
    && response.request().method() === 'PUT'
  ));
  await deckB.getByRole('button', { name: 'Limpar Hot Cue 1 Deck B' }).click();
  expect((await clearHotCue).ok()).toBe(true);
  await deckB.locator('.dj-hot-cue').first().locator('summary').click();
  await expect(deckA.getByRole('button', { name: 'Definir Hot Cue 1 Deck A' })).toBeVisible();
  await expect(deckB.getByRole('button', { name: 'Definir Hot Cue 1 Deck B' })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'Hot Cue 1 no waveform Deck A' })).toHaveCount(0);
  await expect(deckB.getByRole('button', { name: 'Hot Cue 1 no waveform Deck B' })).toHaveCount(0);

  await library.getByRole('option').filter({ hasText: 'E2E Zeta' }).click();
  await dj.getByRole('button', { name: 'LOAD B' }).click();
  await expect(deckB).toContainText('E2E Zeta');
  await expect(deckB.getByRole('button', { name: 'Reproduzir Deck B' })).toBeVisible();
  await expect(library.getByRole('option').filter({ hasText: 'E2E Zeta' }).locator('.dj-library-deck-badge[data-deck="b"]')).toHaveText('B');
  await expect(deckB.getByRole('button', { name: 'Definir Hot Cue 1 Deck B' })).toBeVisible();
  await expect(deckA.getByRole('button', { name: 'Definir Hot Cue 1 Deck A' })).toBeVisible();

  await expect.poll(async () => deckA.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect.poll(async () => deckB.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect.poll(async () => mixer.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect.poll(async () => deckA.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden');
  await expect.poll(async () => deckB.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden');

  const libraryPanel = dj.locator('.dj-pro-library');
  const [deckABox, mixerBox, deckBBox, libraryBox] = await Promise.all([
    deckA.boundingBox(),
    mixer.boundingBox(),
    deckB.boundingBox(),
    libraryPanel.boundingBox()
  ]);
  expect(deckABox).not.toBeNull();
  expect(mixerBox).not.toBeNull();
  expect(deckBBox).not.toBeNull();
  expect(libraryBox).not.toBeNull();
  expect(Math.abs(deckABox!.y - mixerBox!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(deckABox!.y - deckBBox!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs((deckABox!.y + deckABox!.height) - (mixerBox!.y + mixerBox!.height))).toBeLessThanOrEqual(2);
  expect(Math.abs((deckABox!.y + deckABox!.height) - (deckBBox!.y + deckBBox!.height))).toBeLessThanOrEqual(2);
  expect(libraryBox!.y).toBeGreaterThanOrEqual(deckABox!.y + deckABox!.height);

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

  const channelA = mixer.locator('.dj-pro-mixer__channel[data-deck="a"] .dj-mixer-channel-volume input');
  const channelB = mixer.locator('.dj-pro-mixer__channel[data-deck="b"] .dj-mixer-channel-volume input');
  const lowA = mixer.getByRole('slider', { name: 'GRAVES Channel A' });
  const midA = mixer.getByRole('slider', { name: 'MÉDIOS Channel A' });
  const highB = mixer.getByRole('slider', { name: 'AGUDOS Channel B' });
  const filterB = mixer.getByRole('slider', { name: 'FILTRO Channel B' });
  const crossfader = mixer.locator('.dj-pro-mixer__crossfader input');

  await expect(mixer.locator('.dj-pro-mixer__crossfader')).toHaveAttribute('data-side', 'center');
  await lowA.fill('0.5');
  await midA.fill('-0.25');
  await highB.fill('0.75');
  await filterB.fill('-0.5');

  const fxSettings = mixer.locator('details.dj-mixer-fx-settings');
  await fxSettings.locator('summary').click();
  await expect(fxSettings).toHaveAttribute('open', '');

  const echoA = mixer.getByRole('button', { name: 'Echo Channel A' });
  const echoWetA = mixer.getByRole('slider', { name: 'Echo Wet Channel A' });
  const echoFeedbackA = mixer.getByRole('slider', { name: 'Echo Feedback Channel A' });
  const echoDelayA = mixer.getByRole('slider', { name: 'Echo Delay Channel A' });
  const reverbB = mixer.getByRole('button', { name: 'Reverb Channel B' });
  const reverbWetB = mixer.getByRole('slider', { name: 'Reverb Wet Channel B' });

  await expect(echoA).toHaveAttribute('aria-pressed', 'false');
  await echoA.click();
  await echoWetA.fill('0.44');
  await echoFeedbackA.fill('0.35');
  await echoDelayA.fill('0.5');
  await reverbB.click();
  await reverbWetB.fill('0.3');
  await expect(echoA).toHaveAttribute('aria-pressed', 'true');
  await expect(echoWetA).toHaveValue('0.44');
  await expect(echoFeedbackA).toHaveValue('0.35');
  await expect(echoDelayA).toHaveValue('0.5');
  await expect(reverbB).toHaveAttribute('aria-pressed', 'true');
  await expect(reverbWetB).toHaveValue('0.3');
  await fxSettings.locator('summary').click();
  await expect(fxSettings).not.toHaveAttribute('open', '');
  await expect(lowA).toHaveAttribute('aria-valuetext', '9.0 dB');
  await expect(midA).toHaveAttribute('aria-valuetext', '-4.5 dB');
  await expect(highB).toHaveAttribute('aria-valuetext', '13.5 dB');
  await expect(filterB).toHaveAttribute('aria-valuetext', '-50%');

  await library.getByRole('option').filter({ hasText: 'E2E Zeta' }).click();
  await dj.getByRole('button', { name: 'LOAD A' }).click();
  await expect(deckA).toContainText('E2E Zeta');
  await expect(lowA).toHaveValue('0.5');
  await expect(midA).toHaveValue('-0.25');
  await expect(highB).toHaveValue('0.75');
  await expect(filterB).toHaveValue('-0.5');

  await selectedE2eTrack.click();
  await dj.getByRole('button', { name: 'LOAD A' }).click();
  await expect(deckA).toContainText('E2E Track');

  await lowA.dblclick();
  await expect(lowA).toHaveValue('0');
  await channelA.fill('0.42');
  await channelB.fill('0.73');
  await crossfader.fill('-1');
  await expect(mixer.locator('.dj-pro-mixer__crossfader')).toHaveAttribute('data-side', 'a');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="a"] strong')).toHaveText('42%');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="b"] strong')).toHaveText('73%');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('A 100%');

  await midiDrawer.locator('summary').click();
  await expect(midiDrawer).toHaveAttribute('open', '');

  await midi.getByRole('button', { name: 'Conectar' }).click();
  await expect(midi).toContainText('Conectado');
  await midi.getByLabel('Entrada').selectOption('e2e-ddj-input');
  await midi.getByLabel('Saída').selectOption('e2e-ddj-output');

  const diagnostics = midi.getByRole('button', { name: 'Diagnóstico MIDI' });
  await expect(diagnostics).toHaveAttribute('aria-pressed', 'false');
  await diagnostics.click();
  await expect(diagnostics).toHaveAttribute('aria-pressed', 'true');
  await expect(midi.getByLabel('Diagnóstico MIDI ativo')).toContainText('Mova um controle');

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
  const diagnosticPanel = midi.getByLabel('Diagnóstico MIDI ativo');
  await expect(diagnosticPanel).toContainText('E2E DDJ-400');
  await expect(diagnosticPanel).toContainText('Status0xB0');
  await expect(diagnosticPanel).toContainText('Canal7');
  await expect(diagnosticPanel).toContainText('Data 164 · 0x40');
  await expect(diagnosticPanel).toContainText('Data 21 · 0x01');

  await diagnostics.click();
  await expect(diagnostics).toHaveAttribute('aria-pressed', 'false');
  await expect(midi.getByLabel('Diagnóstico MIDI ativo')).toHaveCount(0);

  const e2eZetaOption = library.getByRole('option').filter({ hasText: 'E2E Zeta' });
  await e2eZetaOption.click();
  await expect(e2eZetaOption).toHaveAttribute('aria-selected', 'true');

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

  const selectedIndexBeforeMidiBack = await library.getByRole('option').evaluateAll(elements => (
    elements.findIndex(element => element.getAttribute('aria-selected') === 'true')
  ));
  expect(selectedIndexBeforeMidiBack).toBeGreaterThanOrEqual(0);

  await page.evaluate(() => {
    const input = (globalThis as typeof globalThis & {
      __homeMusicE2eMidiInput?: {
        onmidimessage: ((event: { data: number[]; receivedTime: number }) => void) | null;
      };
    }).__homeMusicE2eMidiInput;
    input?.onmidimessage?.({ data: [0xb6, 0x40, 0x7f], receivedTime: performance.now() });
  });
  await expect(
    library.getByRole('option').nth(Math.max(0, selectedIndexBeforeMidiBack - 1))
  ).toHaveAttribute('aria-selected', 'true');
  await selectedE2eTrack.click();
  await expect(selectedE2eTrack).toHaveAttribute('aria-selected', 'true');

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

  const reconnectZetaOption = library.getByRole('option').filter({ hasText: 'E2E Zeta' });
  await reconnectZetaOption.click();
  await expect(reconnectZetaOption).toHaveAttribute('aria-selected', 'true');
  const reconnectLoadB = dj.getByRole('button', { name: 'LOAD B' });
  if (await reconnectLoadB.isEnabled()) {
    await reconnectLoadB.click();
  }
  await expect(deckB).toContainText('E2E Zeta');

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

  await crossfader.fill('0');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('Centro');

  await dj.getByRole('button', { name: 'AutoMix' }).click();
  await expect(dj.getByRole('button', { name: 'AutoMix' })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.locator('.dj-library-status-badge').filter({ hasText: 'AGORA' })).toHaveCount(1);
  await expect(library.locator('.dj-library-status-badge').filter({ hasText: 'PRÓXIMA' })).toHaveCount(1);
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="a"] strong')).toHaveText('100%');
  await expect(mixer.locator('.dj-pro-mixer__channel[data-deck="b"] strong')).toHaveText('100%');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('Centro');

  await dj.getByRole('button', { name: 'Manual' }).click();
  await expect(dj.getByRole('button', { name: 'Manual' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mixer.locator('.dj-pro-mixer__crossfader strong')).toHaveText('A 100%');

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

test('Modo DJ restaura EQ neutro ao sair e reentrar', async ({ page }) => {
  test.setTimeout(60_000);

  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  const expandTopbar = page.getByRole('button', { name: 'Expandir barra superior' });
  await expect(expandTopbar).toBeVisible();
  await expandTopbar.click();

  const openDjMode = page.getByRole('button', { name: 'Abrir Modo DJ' });
  await expect(openDjMode).toBeVisible();
  await openDjMode.click();
  const dj = page.getByRole('region', { name: 'Modo DJ' });
  const mixer = page.getByRole('region', { name: 'Mixer' });
  await expect(dj).toBeVisible();

  await mixer.getByRole('slider', { name: 'GRAVES Channel A' }).fill('0.5');
  await mixer.getByRole('slider', { name: 'MÉDIOS Channel A' }).fill('-0.25');
  await mixer.getByRole('slider', { name: 'AGUDOS Channel B' }).fill('0.75');
  await mixer.getByRole('slider', { name: 'FILTRO Channel B' }).fill('-0.5');

  await dj.getByRole('button', { name: 'Sair do modo DJ' }).click();
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();

  const reopenTopbar = page.getByRole('button', { name: 'Expandir barra superior' });
  await expect(reopenTopbar).toBeVisible();
  await reopenTopbar.click();

  const reopenDjMode = page.getByRole('button', { name: 'Abrir Modo DJ' });
  await expect(reopenDjMode).toBeVisible();
  await reopenDjMode.click();
  const reopenedDj = page.getByRole('region', { name: 'Modo DJ' });
  const reopenedMixer = page.getByRole('region', { name: 'Mixer' });
  await expect(reopenedDj).toBeVisible();
  await expect(reopenedMixer.getByRole('slider', { name: 'GRAVES Channel A' })).toHaveValue('0');
  await expect(reopenedMixer.getByRole('slider', { name: 'MÉDIOS Channel A' })).toHaveValue('0');
  await expect(reopenedMixer.getByRole('slider', { name: 'AGUDOS Channel B' })).toHaveValue('0');
  await expect(reopenedMixer.getByRole('slider', { name: 'FILTRO Channel B' })).toHaveValue('0');
  const reopenedFxSettings = reopenedMixer.locator('details.dj-mixer-fx-settings');
  await reopenedFxSettings.locator('summary').click();
  await expect(reopenedFxSettings).toHaveAttribute('open', '');
  await expect(reopenedMixer.getByRole('button', { name: 'Echo Channel A' })).toHaveAttribute('aria-pressed', 'false');
  await expect(reopenedMixer.getByRole('button', { name: 'Reverb Channel B' })).toHaveAttribute('aria-pressed', 'false');
});


test('Modo DJ finaliza gravação ao sair e restaura player normal', async ({ page }) => {
  test.setTimeout(60_000);

  await page.addInitScript(() => {
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
          data: new Blob(['home-music-dj-e2e'], { type: this.mimeType })
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

  await page.goto('/');
  await page.getByLabel('Usuário').fill(username);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  const expandTopbar = page.getByRole('button', { name: 'Expandir barra superior' });
  if (await expandTopbar.isVisible()) await expandTopbar.click();
  await page.getByRole('button', { name: 'Abrir Modo DJ' }).click();

  const dj = page.getByRole('region', { name: 'Modo DJ' });
  const rec = dj.getByRole('button', { name: /REC/ });
  await expect(rec).toBeEnabled();
  await rec.click();
  await expect(rec).toHaveAttribute('aria-pressed', 'true');

  const downloadPromise = page.waitForEvent('download');
  await dj.getByRole('button', { name: 'Sair do modo DJ' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^home-music-dj-\d{8}-\d{6}\.webm$/);
  await expect(page.locator('.desktop-now-playing-screen')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Modo DJ' })).toHaveCount(0);
});
