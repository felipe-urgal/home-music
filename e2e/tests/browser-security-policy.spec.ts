import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

test('browser policies allow first-party camera and native LAN HTTP signaling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');

  const response = await page.request.get('/');
  const permissionsPolicy = response.headers()['permissions-policy'] || '';
  const csp = response.headers()['content-security-policy'] || '';

  expect(permissionsPolicy).toContain('camera=(self)');
  expect(permissionsPolicy).toContain('microphone=()');
  expect(permissionsPolicy).toContain('geolocation=()');
  expect(csp).toContain("connect-src 'self' http:");

  await page.goto('/');
  const cameraAllowedByPolicy = await page.evaluate(() => {
    const policy = (document as Document & {
      featurePolicy?: { allowsFeature(feature: string): boolean };
      permissionsPolicy?: { allowsFeature(feature: string): boolean };
    }).permissionsPolicy ?? (document as Document & {
      featurePolicy?: { allowsFeature(feature: string): boolean };
    }).featurePolicy;
    return policy?.allowsFeature('camera') ?? true;
  });
  expect(cameraAllowedByPolicy).toBe(true);

  const server = createServer((request, reply) => {
    reply.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:8791');
    reply.setHeader('Content-Type', 'application/json');
    reply.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('LAN fixture did not expose a TCP port');
    const result = await page.evaluate(async url => {
      const response = await fetch(url);
      return { ok: response.ok, payload: await response.json() as { ok: boolean } };
    }, `http://127.0.0.1:${address.port}/health`);
    expect(result).toEqual({ ok: true, payload: { ok: true, path: '/health' } });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
