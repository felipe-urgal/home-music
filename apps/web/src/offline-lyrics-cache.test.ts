import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from './api-client';
import type { LyricsResponse } from '@home-music/shared';
import {
  commitOfflineLyricsSnapshot, offlineLyricsCacheInternals,
  prepareOfflineLyricsSnapshot, readOfflineLyricsSnapshot
} from './offline-lyrics-cache';

vi.mock('./api-client', () => ({ apiFetch: vi.fn() }));

const synced: LyricsResponse = {
  source: 'lrc',
  synchronized: true,
  lines: [{ time: 1.5, text: 'linha' }]
};

describe('offline lyrics cache', () => {
  it('reconcilia revisão A → B sem regravar áudio, isolada por usuário', async () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); }
    };
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
    try {
      vi.mocked(apiFetch).mockReset();
      const updated = { ...synced, lines: [{ time: 1.5, text: 'linha B' }] };
      vi.mocked(apiFetch)
        .mockResolvedValueOnce(new Response(JSON.stringify(synced), { status: 200, headers: { ETag: '"lyrics-A"' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200, headers: { ETag: '"lyrics-B"' } }))
        .mockResolvedValueOnce(new Response(null, { status: 304 }));

      const first = await prepareOfflineLyricsSnapshot('track', 'user-a');
      expect(first).not.toBeNull();
      expect(commitOfflineLyricsSnapshot(first!, storage)).toBe(true);
      expect(readOfflineLyricsSnapshot('track', 'user-b', storage)).toBeNull();

      const second = await prepareOfflineLyricsSnapshot('track', 'user-a');
      expect(second?.snapshot.revision).toBe('"lyrics-B"');
      expect(commitOfflineLyricsSnapshot(second!, storage)).toBe(true);
      expect(readOfflineLyricsSnapshot('track', 'user-a', storage)).toEqual(updated);

      expect(await prepareOfflineLyricsSnapshot('track', 'user-a')).toBeNull();
      expect(vi.mocked(apiFetch).mock.calls[2]?.[1]).toMatchObject({
        headers: { 'If-None-Match': '"lyrics-B"' }
      });
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });

  it('separa a chave persistida por usuário', () => {
    expect(offlineLyricsCacheInternals.storageKey('user-a')).not.toBe(
      offlineLyricsCacheInternals.storageKey('user-b')
    );
  });

  it('gera revisão estável pelo conteúdo efetivo', () => {
    const first = offlineLyricsCacheInternals.contentRevision(synced);
    expect(first).toBe(offlineLyricsCacheInternals.contentRevision({ ...synced }));
    expect(first).not.toBe(offlineLyricsCacheInternals.contentRevision({
      ...synced,
      lines: [{ time: 1.5, text: 'linha atualizada' }]
    }));
  });

  it('descarta snapshots corrompidos', () => {
    expect(offlineLyricsCacheInternals.parseSnapshots('{')).toEqual({});
    expect(offlineLyricsCacheInternals.parseSnapshots(JSON.stringify({
      track: { revision: 'x', preparedAt: 'now', lyrics: { source: 'x' } }
    }))).toEqual({});
  });
});
