import { describe, expect, it } from 'vitest';
import type { LyricsResponse } from '@home-music/shared';
import { offlineLyricsCacheInternals } from './offline-lyrics-cache';

const synced: LyricsResponse = {
  source: 'lrc',
  synchronized: true,
  lines: [{ time: 1.5, text: 'linha' }]
};

describe('offline lyrics cache', () => {
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
