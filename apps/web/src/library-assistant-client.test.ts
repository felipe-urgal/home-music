import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import {
  cancelLibraryAssistantRun,
  decideLibraryAssistantBatch,
  decideLibraryAssistantSuggestion,
  fingerprintLibraryAssistantSuggestion,
  getLibraryAssistantFingerprintStatus,
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
  it('inicia metadata e lyrics como capabilities independentes em uma análise administrativa', async () => {
    apiFetchMock
      .mockResolvedValueOnce(response({ run: { id: 'run-metadata' } }))
      .mockResolvedValueOnce(response({ run: { id: 'run-lyrics' } }));

    const result = await startLibraryAssistantMetadataRun();

    expect(result.run.id).toBe('run-metadata');
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    for (const call of apiFetchMock.mock.calls) {
      expect(call[0]).toBe('/api/admin/library-assistant/runs');
      expect(call[1]).toMatchObject({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Home-Music-Request': '1'
        }
      });
    }
    expect(apiFetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { capability: 'metadata', full: false },
      { capability: 'lyrics', full: false }
    ]);
  });

  it('propaga reanálise completa para metadata e lyrics', async () => {
    apiFetchMock
      .mockResolvedValueOnce(response({ run: { id: 'run-metadata' } }))
      .mockResolvedValueOnce(response({ run: { id: 'run-lyrics' } }));

    await startLibraryAssistantMetadataRun({ full: true });

    expect(apiFetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { capability: 'metadata', full: true },
      { capability: 'lyrics', full: true }
    ]);
  });

  it('cancela metadata e lyrics ativos como uma única análise da Administração', async () => {
    apiFetchMock
      .mockResolvedValueOnce(response({
        runs: [
          { id: 'run-metadata', capability: 'metadata', status: 'running' },
          { id: 'run-lyrics', capability: 'lyrics', status: 'queued' },
          { id: 'old-run', capability: 'metadata', status: 'completed' }
        ]
      }))
      .mockResolvedValueOnce(response({ run: { id: 'run-metadata' } }))
      .mockResolvedValueOnce(response({ run: { id: 'run-lyrics' } }));

    await cancelLibraryAssistantRun('run-metadata');

    expect(apiFetchMock).toHaveBeenCalledTimes(3);
    expect(apiFetchMock.mock.calls[1]?.[0]).toBe('/api/admin/library-assistant/runs/run-metadata/cancel');
    expect(apiFetchMock.mock.calls[2]?.[0]).toBe('/api/admin/library-assistant/runs/run-lyrics/cancel');
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

  it('lê capability de fingerprint sem expor path ou segredo', async () => {
    apiFetchMock.mockResolvedValue(response({
      fpcalc: { available: true, version: '1.5.1', issue: null },
      acoustIdEnabled: true,
      acoustIdConfigured: true
    }));

    const result = await getLibraryAssistantFingerprintStatus();

    expect(result.fpcalc.available).toBe(true);
    expect(result.acoustIdConfigured).toBe(true);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/library-assistant/fingerprint',
      { cache: 'no-store' }
    );
  });

  it('solicita identificação por áudio usando apenas ids server-side', async () => {
    apiFetchMock.mockResolvedValue(response({
      fingerprintGenerated: true,
      cacheHit: false,
      externalLookup: true,
      identified: true,
      acoustIdEnabled: true,
      runId: 'assistant-fingerprint-1',
      suggestionIds: ['suggestion-2'],
      recordingId: 'recording-1',
      conflict: false,
      ambiguous: false
    }));

    await fingerprintLibraryAssistantSuggestion('run/1', 'suggestion/1');

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/library-assistant/runs/run%2F1/suggestions/suggestion%2F1/fingerprint',
      {
        method: 'POST',
        headers: { 'X-Home-Music-Request': '1' }
      }
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
