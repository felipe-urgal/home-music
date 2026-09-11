import type { Track } from '@home-music/shared';
import { describe, expect, it } from 'vitest';
import type { OfflineCollectionSummary, OfflineDownloadRecord } from './offline-downloads';
import {
  offlineCachedStreamHref,
  offlineCachedStreamUrl,
  readOfflineColdStartRecords,
  reconcileOfflineColdStartCollections
} from './offline-cold-start';

function track(id: string): Track {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Coleção',
    folderPath: 'Coleção',
    duration: 180,
    format: 'MP3',
    hasCover: false
  };
}

function record(id: string): OfflineDownloadRecord {
  return {
    track: track(id),
    size: 100,
    mimeType: 'audio/mpeg',
    downloadedAt: '2026-09-06T12:00:00.000Z'
  };
}

function collection(trackIds: string[]): OfflineCollectionSummary {
  return {
    key: 'folder:Coleção',
    reference: {
      kind: 'folder',
      sourceId: 'Coleção',
      name: 'Coleção',
      trackIds,
      updatedAt: '2026-09-06T12:00:00.000Z'
    },
    totalCount: trackIds.length,
    downloadedCount: trackIds.length,
    downloadingCount: 0,
    status: 'available',
    error: null
  };
}

describe('offline cold start', () => {
  it('usa a mesma chave física de stream criada pelo downloader', () => {
    expect(offlineCachedStreamUrl('faixa / 1')).toBe('/api/tracks/faixa%20%2F%201/stream');
    expect(offlineCachedStreamHref('faixa / 1', 'https://music.example')).toBe('https://music.example/api/tracks/faixa%20%2F%201/stream');
  });

  it('reconcilia manifesto contra o cache do usuário com uma única listagem física', async () => {
    const openedNames: string[] = [];
    let keysCalls = 0;
    const records = Array.from({ length: 780 }, (_value, index) => record(`track-${index}`));
    const cacheStorage = {
      async open(name: string) {
        openedNames.push(name);
        return {
          async keys() {
            keysCalls += 1;
            return records.map(item => new Request(`http://localhost/api/tracks/${item.track.id}/stream`));
          }
        };
      }
    } as unknown as CacheStorage;

    const result = await readOfflineColdStartRecords(
      records,
      { userId: 'user-a', cacheStorage }
    );

    expect(openedNames).toEqual(['home-music-offline-audio-v2-user-a']);
    expect(keysCalls).toBe(1);
    expect(result).toEqual(records);
  });

  it('recalcula contagem e status das coleções após filtrar bytes ausentes', () => {
    const result = reconcileOfflineColdStartCollections(
      [collection(['a', 'b'])],
      [record('a')]
    );

    expect(result[0]?.downloadedCount).toBe(1);
    expect(result[0]?.status).toBe('partial');

    const empty = reconcileOfflineColdStartCollections(
      [collection(['a', 'b'])],
      []
    );
    expect(empty[0]?.downloadedCount).toBe(0);
    expect(empty[0]?.status).toBe('not-downloaded');
  });

  it('não reutiliza cache sem identidade offline conhecida', async () => {
    let opened = false;
    const cacheStorage = {
      async open() {
        opened = true;
        throw new Error('não deveria abrir cache');
      }
    } as unknown as CacheStorage;

    const result = await readOfflineColdStartRecords([record('a')], {
      userId: null,
      cacheStorage
    });

    expect(result).toBeNull();
    expect(opened).toBe(false);
  });

  it('preserva o manifesto quando a reconciliação física não pode ser concluída', async () => {
    const cacheStorage = {
      async open() {
        throw new Error('cache temporariamente indisponível');
      }
    } as unknown as CacheStorage;

    const result = await readOfflineColdStartRecords([record('a')], {
      userId: 'user-a',
      cacheStorage
    });

    expect(result).toBeNull();
  });
});
