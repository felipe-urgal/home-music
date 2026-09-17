import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveTvDeviceLogin,
  cancelTvDeviceLogin,
  consumeTvDeviceLogin,
  getTvDeviceLoginStatus,
  previewTvDeviceLogin,
  startTvDeviceLogin
} from './tv-device-login-client';

const requestId = 'request_1234567890123456';
const deviceToken = 'device_1234567890123456';
const approvalToken = 'approval_1234567890123456';

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('tv device login client', () => {
  it('starts and polls with the expected protected headers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ requestId, deviceToken, approvalToken, displayCode: '654321', expiresAt: '2026-09-17T21:00:00.000Z' }))
      .mockResolvedValueOnce(json({ state: 'pending' }));
    vi.stubGlobal('fetch', fetchMock);

    await startTvDeviceLogin();
    await getTvDeviceLoginStatus(requestId, deviceToken);

    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      headers: expect.objectContaining({ 'X-Home-Music-Request': '1' })
    }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/auth/device/${encodeURIComponent(requestId)}/status`);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'X-Home-Music-Device-Token': deviceToken })
    }));
  });

  it('previews and approves using the authenticated mobile session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ displayCode: '654321' }))
      .mockResolvedValueOnce(json({ approved: true, displayCode: '654321' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(previewTvDeviceLogin(approvalToken)).resolves.toEqual({ displayCode: '654321' });
    await expect(approveTvDeviceLogin(approvalToken)).resolves.toEqual({ approved: true, displayCode: '654321' });

    for (const call of fetchMock.mock.calls) {
      const options = call[1] as RequestInit;
      expect(options.credentials).toBe('same-origin');
      expect(options.body).toBe(JSON.stringify({ approvalToken }));
    }
  });

  it('consumes or cancels with the TV secret and reports terminal state errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: 'expired', state: 'expired' }, 409))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(consumeTvDeviceLogin(requestId, deviceToken)).rejects.toMatchObject({
      name: 'TvDeviceLoginHttpError',
      status: 409,
      state: 'expired'
    });
    await expect(cancelTvDeviceLogin(requestId, deviceToken)).resolves.toBeUndefined();
  });
});
