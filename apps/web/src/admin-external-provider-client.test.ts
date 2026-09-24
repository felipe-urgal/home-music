import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import { searchAdminExternalProvider } from './admin-external-provider-client';

vi.mock('./api-client', () => ({
  apiFetch: vi.fn()
}));

const apiFetchMock = vi.mocked(apiFetch);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('admin external provider client', () => {
  it('busca conteúdo por texto sem iniciar importação', async () => {
    apiFetchMock.mockResolvedValueOnce(response({
      query: 'Djavan Samurai',
      items: [{
        id: 'abcDEF_1234',
        title: 'Samurai',
        artist: 'Djavan',
        durationSeconds: 312,
        thumbnailUrl: 'https://i.ytimg.com/vi/abcDEF_1234/hqdefault.jpg',
        sourceUrl: 'https://www.youtube.com/watch?v=abcDEF_1234',
        provider: 'yt-dlp'
      }]
    }));

    const result = await searchAdminExternalProvider('yt-dlp', 'Djavan Samurai');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Samurai');
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[0]).toBe('/api/admin/imports/providers/yt-dlp/search');
    expect(apiFetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Home-Music-Request': '1'
      }
    });
    expect(JSON.parse(String(apiFetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      query: 'Djavan Samurai'
    });
  });

  it('propaga erro de busca do backend', async () => {
    apiFetchMock.mockResolvedValueOnce(response({ error: 'Busca indisponível.' }, 503));
    await expect(searchAdminExternalProvider('yt-dlp', 'Djavan')).rejects.toThrow('Busca indisponível.');
  });
});
