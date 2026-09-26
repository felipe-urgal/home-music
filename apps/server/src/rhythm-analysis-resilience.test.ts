import assert from 'node:assert/strict';
import { mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import type { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import type { LibraryService } from './library-service.js';
import { registerMediaRoutes } from './media-routes.js';
import { RhythmAnalysisScheduler } from './rhythm-analysis-scheduler.js';
import { registerSystemRoutes } from './system-routes.js';
import type { TrackMediaInfrastructure } from './track-media-infrastructure.js';

test('falha da análise rítmica não afeta readiness nem streaming direto', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'home-music-rhythm-resilience-'));
  const filePath = path.join(root, 'track.bin');
  const payload = Buffer.from('home-music-stream-ok');
  await writeFile(filePath, payload);
  const info = await stat(filePath);

  const track: IndexedTrack = {
    id: 'track-a',
    title: 'Faixa',
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Teste',
    folderPath: 'Teste',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath,
    mimeType: 'audio/mpeg',
    fileSize: info.size,
    mtimeMs: info.mtimeMs
  };

  const library = {
    ready: true,
    root,
    enabledTrackCount: 1,
    allTracks: [track],
    getTrack: (trackId: string) => trackId === track.id ? track : undefined,
    applyRhythmAnalysis: () => {
      throw new Error('Resultado de análise com falha não deve ser publicado.');
    },
    status: () => ({
      scannedAt: '2026-09-26T12:00:00.000Z',
      scanning: false,
      revision: 1,
      autoRescan: { enabled: false, intervalSeconds: null }
    })
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: () => {
      throw new Error('Análise que falhou não deve ser persistida.');
    }
  } as unknown as HomeMusicDatabase;

  const warnings: Array<{ bindings: object; message: string }> = [];
  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger: {
      warn: (bindings, message) => {
        warnings.push({ bindings, message });
      }
    },
    analyze: async () => {
      throw new Error('FFmpeg timeout simulado');
    }
  });

  const media = {
    openTrack: async (trackId: string) => {
      if (trackId !== track.id) return null;
      return {
        track,
        opened: {
          handle: await open(filePath, 'r'),
          stat: await stat(filePath)
        }
      };
    }
  } as unknown as TrackMediaInfrastructure;

  const app = Fastify();
  registerMediaRoutes(app, library, media);
  registerSystemRoutes(app, {
    isProduction: false,
    musicDirConfigured: true,
    authConfigured: true,
    transcodeCacheMegabytes: 256,
    library,
    getFfmpegStatus: () => ({
      available: true,
      version: 'ffmpeg test',
      issue: null,
      customCommand: false
    }),
    getSchemaVersion: () => 14,
    getTranscodingRuntime: () => ({ active: 0, pending: 0 }),
    getRhythmAnalysisRuntime: () => scheduler.runtime,
    isWebReady: () => true
  });

  try {
    scheduler.sync();
    for (let attempt = 0; attempt < 100 && scheduler.runtime.failed === 0; attempt += 1) {
      await new Promise<void>(resolve => setImmediate(resolve));
    }

    assert.equal(scheduler.runtime.failed, 1);
    assert.equal(scheduler.runtime.timeouts, 1);
    assert.equal(scheduler.runtime.active, 0);
    assert.equal(warnings.length, 1);
    assert.deepEqual(
      Object.keys(warnings[0]?.bindings ?? {}).sort(),
      ['err', 'trackId']
    );

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    assert.equal(ready.statusCode, 200);
    assert.deepEqual(ready.json(), { ready: true });

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.statusCode, 200);
    const healthBody = health.json();
    assert.equal(healthBody.ready, true);
    assert.equal(healthBody.rhythmAnalysis.enabled, true);
    assert.equal(healthBody.rhythmAnalysis.failed, 1);
    assert.equal(healthBody.rhythmAnalysis.timeouts, 1);

    const stream = await app.inject({
      method: 'GET',
      url: `/api/tracks/${track.id}/stream`
    });
    assert.equal(stream.statusCode, 200);
    assert.equal(stream.headers['content-type'], track.mimeType);
    assert.deepEqual(stream.rawPayload, payload);
  } finally {
    await scheduler.stop();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
