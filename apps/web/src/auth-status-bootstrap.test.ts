import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STATUS_TIMEOUT_MS, fetchAuthStatusResponse } from './auth-status-bootstrap';

afterEach(() => {
  vi.useRealTimers();
});

describe('fetchAuthStatusResponse', () => {
  it('não consulta o servidor quando o navegador já reporta offline', async () => {
    const fetchImpl = vi.fn(async () => new Response());

    await expect(fetchAuthStatusResponse({ fetchImpl, online: false })).rejects.toThrow('Navegador offline.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('aborta a verificação quando o servidor não responde dentro do orçamento', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));

    const pending = fetchAuthStatusResponse({ fetchImpl, online: true, timeoutMs: 25 });
    const rejection = expect(pending).rejects.toThrow('aborted');

    await vi.advanceTimersByTimeAsync(25);
    await rejection;

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/auth/status', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal)
    }));
  });

  it('preserva a resposta real do servidor quando ela chega a tempo', async () => {
    const response = new Response(null, { status: 401 });
    const fetchImpl = vi.fn(async () => response);

    await expect(fetchAuthStatusResponse({ fetchImpl, online: true, timeoutMs: AUTH_STATUS_TIMEOUT_MS })).resolves.toBe(response);
  });
});
