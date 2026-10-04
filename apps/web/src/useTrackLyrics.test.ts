import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricsResponse } from '@home-music/shared';
import { apiFetch } from './api-client';
import { loadTrackLyrics } from './useTrackLyrics';

vi.mock('./api-client', () => ({
  apiFetch: vi.fn()
}));

const lyrics: LyricsResponse = {
  source: 'lrc',
  synchronized: true,
  lines: [{ time: 0, text: 'Linha' }]
};

describe('loadTrackLyrics', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
  });

  it('compartilha a mesma request enquanto a letra da faixa está em voo', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify(lyrics), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const [first, second] = await Promise.all([
      loadTrackLyrics('track-a'),
      loadTrackLyrics('track-a')
    ]);

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(first).toEqual(lyrics);
    expect(second).toEqual(lyrics);
  });

  it('não mantém cache permanente depois que a request termina', async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(lyrics), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(lyrics), { status: 200 }));

    await loadTrackLyrics('track-b');
    await loadTrackLyrics('track-b');

    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
});
