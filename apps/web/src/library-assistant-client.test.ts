import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import {
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  getLibraryAssistantReview,
  startLibraryAssistantMetadataRun
} from './library-assistant-client';

vi.mock('./api-client', () => ({
  apiFetch: vi.fn()
}));

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const apiFetchMock = vi.mocked(apiFetch);

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('library assistant admin client', () => {
  it('inicia análise de metadata com mutação administrativa explícita', async () => {
    apiFetchMock.mockResolvedValue(response({ run: { id: 'run-1' } }));

    await startLibraryAssistantMetadataRun();

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/library-assistant/runs');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    });
    expect(JSON.parse(String(init.body))).toEqual({ capability: 'metadata' });
  });

  it('envia apenas a decisão explícita da sugestão selecionada', async () => {
    apiFetchMock.mockResolvedValue(response({ suggestion: { id: 'suggestion-1' } }));
    const decision = {
      suggestionId: 'suggestion/1',
      action: 'apply' as const,
      fields: ['title', 'artist'] as const
    };

    await decideLibraryAssistantSuggestion(decision);

    const [url, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/library-assistant/suggestions/suggestion%2F1/decision');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Home-Music-Request': '1' });
    expect(JSON.parse(String(init.body))).toEqual(decision);
  });

  it('preserva seleção explícita no lote e usa o mesmo header de mutação', async () => {
    apiFetchMock.mockResolvedValue(response({ results: [] }));
    const decisions = [
      { suggestionId: 'suggestion-1', action: 'apply' as const, fields: ['album'] as const },
      { suggestionId: 'suggestion-2', action: 'reject' as const }
    ];

    await decideLibraryAssistantBatch(decisions);

    const [url, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/library-assistant/decisions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Home-Music-Request': '1' });
    expect(JSON.parse(String(init.body))).toEqual({ decisions });
  });

  it('faz leitura sem cache e expõe a mensagem de erro retornada pelo servidor', async () => {
    apiFetchMock
      .mockResolvedValueOnce(response({ counts: {}, suggestions: [] }))
      .mockResolvedValueOnce(response({ error: 'Sugestão ficou stale.' }, 409));

    await getLibraryAssistantReview(123);
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/admin/library-assistant/review?limit=123',
      { cache: 'no-store' }
    );

    await expect(decideLibraryAssistantBatch([])).rejects.toThrow('Sugestão ficou stale.');
  });
});
