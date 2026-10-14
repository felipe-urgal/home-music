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

  it('cold start sem rede mantém apenas arquivos presentes no cache da conta atual', async () => {
    const openedNames: string[] = [];
    const cacheStorage = {
      async open(name: string) {
        openedNames.push(name);
        return {
          async keys() {
            return [new Request('http://localhost/api/tracks/a/stream')];
          }
        };
      }
    } as unknown as CacheStorage;
    const result = await readOfflineColdStartRecords([record('a'), record('b')], {
      userId: 'user-a', cacheStorage
    });
    expect(result?.map(item => item.track.id)).toEqual(['a']);
    expect(openedNames).toEqual(['home-music-offline-audio-v2-user-a']);
    const collections = reconcileOfflineColdStartCollections([collection(['a', 'b'])], result ?? []);
    expect(collections[0]?.status).toBe('partial');
    expect(collections[0]?.downloadedCount).toBe(1);
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
  it('não exibe bytes de outra conta mesmo com IDs de faixa idênticos', async () => {
    const opened: string[] = [];
    const cacheStorage = {
      async open(name: string) {
        opened.push(name);
        return {
          async keys() {
            return name.endsWith('user-a')
              ? [new Request('http://localhost/api/tracks/shared/stream')]
              : [];
          }
        };
      }
    } as unknown as CacheStorage;

    const a = await readOfflineColdStartRecords([record('shared')], {
      userId: 'user-a', cacheStorage
    });
    const b = await readOfflineColdStartRecords([record('shared')], {
      userId: 'user-b', cacheStorage
    });

    expect(a?.map(item => item.track.id)).toEqual(['shared']);
    expect(b).toEqual([]);
    expect(opened).toEqual([
      'home-music-offline-audio-v2-user-a',
      'home-music-offline-audio-v2-user-b'
    ]);
  });

  it('recupera a reconciliação após falha temporária sem perder o snapshot', async () => {
    let unavailable = true;
    const cacheStorage = {
      async open() {
        if (unavailable) throw new Error('backend e storage temporariamente indisponíveis');
        return {
          async keys() {
            return [new Request('http://localhost/api/tracks/a/stream')];
          }
        };
      }
    } as unknown as CacheStorage;
    const snapshot = [record('a'), record('b')];

    expect(await readOfflineColdStartRecords(snapshot, { userId: 'user-a', cacheStorage })).toBeNull();
    expect(snapshot).toHaveLength(2);

    unavailable = false;
    const recovered = await readOfflineColdStartRecords(snapshot, {
      userId: 'user-a', cacheStorage
    });
    expect(recovered?.map(item => item.track.id)).toEqual(['a']);
    expect(reconcileOfflineColdStartCollections([collection(['a', 'b'])], recovered ?? [])[0]?.status).toBe('partial');
  });

});
