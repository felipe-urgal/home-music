import { describe, expect, it } from 'vitest';
import type { Track } from '@home-music/shared';
import {
  collectionStatus,
  formatOfflineBytes,
  offlineAudioCacheName,
  offlineAudioUrl,
  offlineManifestKey,
  parseOfflineManifest
} from './offline-downloads';

const track: Track = {
  id: 'abc123',
  title: 'Teste',
  artist: 'Artista',
  album: 'Álbum',
  albumArtist: 'Artista',
  folder: 'Pasta',
  folderPath: 'Pasta',
  duration: 180,
  format: 'MP3',
  hasCover: true
};

describe('offline downloads', () => {
  it('gera uma URL virtual que identifica somente a faixa', () => {
    expect(offlineAudioUrl('abc 123')).toBe('/offline-audio/abc%20123');
    expect(offlineAudioUrl('abc123')).not.toContain('user');
  });

  it('separa manifesto e cache de áudio entre usuários', () => {
    expect(offlineManifestKey('user-a')).not.toBe(offlineManifestKey('user-b'));
    expect(offlineAudioCacheName('user-a')).not.toBe(offlineAudioCacheName('user-b'));
    expect(offlineManifestKey('user-a')).toContain('user-a');
    expect(offlineAudioCacheName('user-b')).toContain('user-b');
  });

  it('lê somente registros válidos e elimina ids duplicados', () => {
    const result = parseOfflineManifest(JSON.stringify([
      { track, size: 1024, mimeType: 'audio/mpeg', downloadedAt: '2026-08-25T10:00:00.000Z' },
      { track, size: 2048, mimeType: 'audio/mpeg', downloadedAt: '2026-08-25T11:00:00.000Z' },
      { track: { id: 'inválido' }, size: -1 }
    ]));

    expect(result).toHaveLength(1);
    expect(result[0]?.track.id).toBe(track.id);
    expect(result[0]?.size).toBe(1024);
  });

  it('trata manifesto corrompido como vazio', () => {
    expect(parseOfflineManifest('{')).toEqual([]);
    expect(parseOfflineManifest(null)).toEqual([]);
  });

  it('formata espaço usado sem casas excessivas', () => {
    expect(formatOfflineBytes(0)).toBe('0 B');
    expect(formatOfflineBytes(1024)).toBe('1.00 KB');
    expect(formatOfflineBytes(12 * 1024 * 1024)).toBe('12.0 MB');
  });

  it('coleção parcial recupera após retry sem descartar bytes já válidos', () => {
    const reference = {
      kind: 'playlist' as const,
      sourceId: 'retry',
      name: 'Recuperação',
      trackIds: ['valid', 'missing'],
      updatedAt: '2026-10-14T00:00:00.000Z'
    };
    const runtime = {
      userId: 'account-a',
      syncingKeys: new Set<string>(),
      pausedKeys: new Set<string>(),
      errors: new Map<string, string>()
    };
    const valid = new Set(['valid']);
    const noTransfers = new Set<string>();
    const partial = collectionStatus(reference, valid, noTransfers, runtime);
    expect(partial).toMatchObject({ status: 'partial', downloadedCount: 1, totalCount: 2 });
    const key = 'playlist:retry';
    runtime.errors.set(key, 'Rede indisponível');
    const errored = collectionStatus(reference, valid, noTransfers, runtime);
    expect(errored).toMatchObject({ status: 'error', downloadedCount: 1 });
    runtime.errors.delete(key);
    runtime.syncingKeys.add(key);
    const retrying = collectionStatus(reference, valid, new Set(['missing']), runtime);
    expect(retrying).toMatchObject({ status: 'downloading', downloadedCount: 1, downloadingCount: 1 });
    runtime.syncingKeys.delete(key);
    const available = collectionStatus(reference, new Set(['valid', 'missing']), noTransfers, runtime);
    expect(available).toMatchObject({ status: 'available', downloadedCount: 2, error: null });
  });

});
