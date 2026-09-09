import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import {
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  getLibraryAssistantReview,
  getLibraryAssistantRunProgress,
  resetLibraryAssistantReview,
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
    expect(JSON.parse(String(init.body))).toEqual({ capability: 'metadata', full: false });
  });

  it('inicia reanálise completa somente quando solicitado', async () => {
    apiFetchMock.mockResolvedValue(response({ run: { id: 'run-2' } }));

    await startLibraryAssistantMetadataRun({ full: true });

    const [, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ capability: 'metadata', full: true });
  });

  it('lê o progresso persistente do run sem cache', async () => {
    apiFetchMock.mockResolvedValue(response({
      progress: {
        total: 1328,
        processed: 250,
        pending: 1040,
        processing: 1,
        matched: 213,
        noMatch: 13,
        retry: 24,
        failed: 0
      }
    }));

    const result = await getLibraryAssistantRunProgress('run/1');

    expect(result.progress.processed).toBe(250);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/library-assistant/runs/run%2F1/progress',
      { cache: 'no-store' }
    );
  });

  it('envia a decisão explícita da sugestão com a premissa esperada', async () => {
    apiFetchMock.mockResolvedValue(response({ result: { outcome: 'applied' } }));
    const decision = {
      runId: 'run-1',
      suggestionId: 'suggestion/1',
      action: 'apply' as const,
      expectedLibraryRevision: 42,
      expectedCurrentValue: 'Título atual'
    };

    await decideLibraryAssistantSuggestion(decision);

    const [url, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/library-assistant/suggestions/suggestion%2F1/decision');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Home-Music-Request': '1' });
    expect(JSON.parse(String(init.body))).toEqual(decision);
  });

  it('preserva exatamente as decisões selecionadas no lote seguro', async () => {
    apiFetchMock.mockResolvedValue(response({ results: [], summary: {} }));
    const decisions = [
      {
        runId: 'run-1',
        suggestionId: 'suggestion-1',
        action: 'apply' as const,
        expectedLibraryRevision: 42,
        expectedCurrentValue: 'Álbum atual'
      },
      {
        runId: 'run-1',
        suggestionId: 'suggestion-2',
        action: 'reject' as const,
        expectedLibraryRevision: 42,
        expectedCurrentValue: 'Artista atual'
      }
    ];

    await decideLibraryAssistantBatch(decisions);

    const [url, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/admin/library-assistant/decisions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'X-Home-Music-Request': '1' });
    expect(JSON.parse(String(init.body))).toEqual({ decisions, confirmReview: false });
  });

  it('propaga confirmação explícita quando o lote contém itens de revisão', async () => {
    apiFetchMock.mockResolvedValue(response({ results: [], summary: {} }));
    const decisions = [{
      runId: 'run-1',
      suggestionId: 'suggestion-review',
      action: 'apply' as const,
      expectedLibraryRevision: 42,
      expectedCurrentValue: 'Título atual'
    }];

    await decideLibraryAssistantBatch(decisions, { confirmReview: true });

    const [, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ decisions, confirmReview: true });
  });

  it('limpa somente a fila aberta por uma mutação administrativa dedicada', async () => {
    apiFetchMock.mockResolvedValue(response({ invalidated: 38 }));

    const result = await resetLibraryAssistantReview();

    expect(result.invalidated).toBe(38);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/library-assistant/review/reset',
      {
        method: 'POST',
        headers: { 'X-Home-Music-Request': '1' }
      }
    );
  });

  it('faz leitura sem cache e expõe a mensagem de erro retornada pelo servidor', async () => {
    apiFetchMock
      .mockResolvedValueOnce(response({ libraryRevision: 42, items: [] }))
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
