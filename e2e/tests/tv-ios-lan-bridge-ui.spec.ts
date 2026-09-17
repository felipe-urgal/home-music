import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';

const bridgeRoot = path.resolve(fileURLToPath(new URL('../../android-tv/app/src/main/assets/', import.meta.url)));
const bridgeOrigin = 'http://192.168.1.40:43123';
const parentOrigin = 'https://home-music.test';
const channelId = 'channel_1234567890abcdef';

async function serveBridge(context: BrowserContext, options: { challengeStatus?: number } = {}) {
  await context.route(`${parentOrigin}/**`, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Home Music test opener</title>'
  }));
  await context.route(`${bridgeOrigin}/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/bridge' || url.pathname === '/bridge.js') {
      const file = path.resolve(bridgeRoot, url.pathname === '/bridge' ? 'bridge.html' : 'bridge.js');
      const body = await readFile(file);
      return route.fulfill({
        status: 200,
        contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html',
        body
      });
    }
    if (url.pathname === '/challenge') {
      const status = options.challengeStatus ?? 200;
      return route.fulfill({
        status,
        contentType: 'application/json',
        json: status === 200
          ? {
              sessionId: 'session_1234567890abcdef',
              clientNonce: 'clientnonce_1234567890',
              tvNonce: 'tvnonce_1234567890',
              expiresAt: Date.now() + 60_000
            }
          : { error: 'Pareamento expirado ou indisponível.' }
      });
    }
    if (url.pathname === '/join') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { sessionToken: 'token_1234567890abcdef', expiresAt: Date.now() + 60_000 }
      });
    }
    if (url.pathname === '/close') {
      return route.fulfill({ status: 200, contentType: 'application/json', json: {} });
    }
    if (url.pathname === '/signals') {
      return request.method() === 'POST'
        ? route.fulfill({ status: 204 })
        : route.fulfill({ status: 200, contentType: 'application/json', json: { cursor: 0, messages: [] } });
    }
    return route.fulfill({ status: 404 });
  });
}

async function openBridge(browser: Browser, options: { challengeStatus?: number } = {}) {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'close', {
      configurable: true,
      value: () => {
        document.documentElement.dataset.closeRequested = 'true';
      }
    });
  });
  await serveBridge(context, options);

  const parent = await context.newPage();
  await parent.goto(`${parentOrigin}/`);
  const popupPromise = context.waitForEvent('page');
  const bridgeUrl = `${bridgeOrigin}/bridge?origin=${encodeURIComponent(parentOrigin)}&channelId=${encodeURIComponent(channelId)}`;
  await parent.evaluate(url => {
    const testWindow = window as typeof window & { bridgePopup?: Window | null };
    testWindow.bridgePopup = window.open(url, 'home-music-lan-bridge-test');
  }, bridgeUrl);
  const bridge = await popupPromise;
  await bridge.waitForLoadState('domcontentloaded');
  return { context, parent, bridge };
}

async function postRequest(parent: Page, requestId: string, operation: string, payload: unknown) {
  const expiresAt = Date.now() + 10_000;
  await parent.evaluate(({ targetOrigin, frame }) => {
    const testWindow = window as typeof window & { bridgePopup?: Window | null };
    if (!testWindow.bridgePopup) throw new Error('bridge popup missing');
    testWindow.bridgePopup.postMessage(frame, targetOrigin);
  }, {
    targetOrigin: bridgeOrigin,
    frame: {
      version: 1,
      type: 'request',
      channelId,
      requestId,
      operation,
      expiresAt,
      payload
    }
  });
}

test('bridge iOS mostra waiting, pairing e P2P pronto sem expor credenciais', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  const { context, parent, bridge } = await openBridge(browser);
  const proof = 'proof_1234567890abcdef';
  try {
    await expect(bridge.locator('body')).toHaveAttribute('data-state', 'waiting');
    await expect(bridge.getByText(/Volte ao Home Music/)).toBeVisible();

    await postRequest(parent, 'request_challenge_1234567890', 'challenge', {
      sessionId: 'session_1234567890abcdef',
      clientNonce: 'clientnonce_1234567890'
    });
    await expect(bridge.locator('body')).toHaveAttribute('data-state', 'pairing');

    await postRequest(parent, 'request_join_1234567890abcd', 'join', {
      sessionId: 'session_1234567890abcdef',
      clientNonce: 'clientnonce_1234567890',
      tvNonce: 'tvnonce_1234567890',
      expiresAt: Date.now() + 60_000,
      proof
    });
    await expect(bridge.locator('body')).toHaveAttribute('data-state', 'pairing');
    await expect(bridge.locator('body')).not.toContainText(proof);

    await postRequest(parent, 'request_complete_1234567890', 'complete', null);
    await expect(bridge.locator('body')).toHaveAttribute('data-state', 'ready');
    await expect(bridge.getByRole('heading', { name: 'Conexão P2P pronta' })).toBeVisible();
    await expect(bridge.getByRole('button', { name: 'Voltar ao Home Music' })).toBeVisible();
    await expect(bridge.locator('html')).toHaveAttribute('data-close-requested', 'true');
  } finally {
    await context.close();
  }
});

test('bridge iOS diferencia pareamento expirado de erro genérico', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  const { context, parent, bridge } = await openBridge(browser, { challengeStatus: 410 });
  try {
    await postRequest(parent, 'request_expired_1234567890a', 'challenge', {
      sessionId: 'session_1234567890abcdef',
      clientNonce: 'clientnonce_1234567890'
    });
    await expect(bridge.locator('body')).toHaveAttribute('data-state', 'expired');
    await expect(bridge.getByRole('heading', { name: 'Pareamento expirou' })).toBeVisible();
    await expect(bridge.getByText(/novo pareamento/i)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('bridge iOS mostra sessão encerrada e mantém fallback manual de retorno', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  const { context, parent, bridge } = await openBridge(browser);
  try {
    await postRequest(parent, 'request_close_1234567890abc', 'close', {
      authorization: 'HomeMusic aaaaaaaaaaaaaaaa.1234567890.request_1234567890abcdef.bbbbbbbbbbbbbbbb'
    });
    await expect(bridge.locator('body')).toHaveAttribute('data-state', 'closed');
    await expect(bridge.getByRole('heading', { name: 'Sessão encerrada' })).toBeVisible();
    await expect(bridge.getByRole('button', { name: 'Voltar ao Home Music' })).toBeVisible();
    await expect(bridge.locator('html')).toHaveAttribute('data-close-requested', 'true');
  } finally {
    await context.close();
  }
});
