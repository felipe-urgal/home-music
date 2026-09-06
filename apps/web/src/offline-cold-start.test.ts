import type { Track } from '@home-music/shared';
import { describe, expect, it } from 'vitest';
import type { OfflineDownloadRecord } from './offline-downloads';
import {
  filterOfflineRecordsWithBytes,
  offlineCachedStreamUrl,
  readOfflineColdStartRecords
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

describe('offline cold start', () => {
  it('preserva ordem e ignora registros cujo blob não existe mais', async () => {
    const records = [record('a'), record('b'), record('c')];
    const result = await filterOfflineRecordsWithBytes(
      records,
      async trackId => trackId !== 'b'
    );

    expect(result.map(item => item.track.id)).toEqual(['a', 'c']);
  });

  it('falha fechado quando a verificação física de um item falha', async () => {
    const records = [record('a'), record('b')];
    const result = await filterOfflineRecordsWithBytes(records, async trackId => {
      if (trackId === 'a') throw new Error('cache indisponível');
      return true;
    });

    expect(result.map(item => item.track.id)).toEqual(['b']);
  });

  it('usa a mesma chave física de stream criada pelo downloader', () => {
    expect(offlineCachedStreamUrl('faixa / 1')).toBe('/api/tracks/faixa%20%2F%201/stream');
  });

  it('reconcilia manifesto contra o cache do usuário sem depender de serviceWorker.controller', async () => {
    const openedNames: string[] = [];
    const matchedUrls: string[] = [];
    const cacheStorage = {
      async open(name: string) {
        openedNames.push(name);
        return {
          async match(input: RequestInfo | URL) {
            const value = String(input);
            matchedUrls.push(value);
            return value.includes('/track-a/') ? new Response('audio') : undefined;
          }
        };
      }
    } as unknown as CacheStorage;

    const result = await readOfflineColdStartRecords(
      [record('track-a'), record('track-b')],
      { userId: 'user-a', cacheStorage }
    );

    expect(openedNames).toEqual(['home-music-offline-audio-v2-user-a']);
    expect(matchedUrls).toEqual([
      '/api/tracks/track-a/stream',
      '/api/tracks/track-b/stream'
    ]);
    expect(result.map(item => item.track.id)).toEqual(['track-a']);
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

    expect(result).toEqual([]);
    expect(opened).toBe(false);
  });
});
