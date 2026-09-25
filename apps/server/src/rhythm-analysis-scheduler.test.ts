import assert from 'node:assert/strict';
import test from 'node:test';
import type { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import type { LibraryService } from './library-service.js';
import { RhythmAnalysisScheduler } from './rhythm-analysis-scheduler.js';

function track(): IndexedTrack {
  return {
    id: 'track-a',
    title: 'Faixa',
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Rock',
    folderPath: 'Rock',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: '/music/a.mp3',
    mimeType: 'audio/mpeg',
    fileSize: 123,
    mtimeMs: 456
  };
}

const logger = {
  warn: () => undefined
};

test('scheduler deduplica a mesma faixa enquanto a análise está em voo', async () => {
  let current = track();
  let analyzeCalls = 0;
  let saveCalls = 0;
  let applyCalls = 0;
  let resolveApplied!: () => void;
  const applied = new Promise<void>(resolve => {
    resolveApplied = resolve;
  });

  const library = {
    allTracks: [current],
    getTrack: (trackId: string) => trackId === current.id ? current : undefined,
    applyRhythmAnalysis: (
      trackId: string,
      sourceFileSize: number,
      sourceMtimeMs: number,
      rhythm: NonNullable<IndexedTrack['rhythm']>
    ) => {
      assert.equal(trackId, current.id);
      assert.equal(sourceFileSize, current.fileSize);
      assert.equal(sourceMtimeMs, current.mtimeMs);
      applyCalls += 1;
      current = { ...current, rhythm };
      resolveApplied();
      return true;
    }
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: () => {
      saveCalls += 1;
      return true;
    }
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger,
    analyze: async () => {
      analyzeCalls += 1;
      await Promise.resolve();
      return { bpm: 128, firstBeatSeconds: 0.3, confidence: 0.9 };
    }
  });

  scheduler.sync();
  scheduler.sync();
  await applied;
  await scheduler.stop();

  assert.equal(analyzeCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(applyCalls, 1);
});

test('resultado obsoleto rejeitado pelo banco não é publicado no snapshot', async () => {
  const current = track();
  let applyCalls = 0;
  let resolvePersisted!: () => void;
  const persisted = new Promise<void>(resolve => {
    resolvePersisted = resolve;
  });

  const library = {
    allTracks: [current],
    getTrack: (trackId: string) => trackId === current.id ? current : undefined,
    applyRhythmAnalysis: () => {
      applyCalls += 1;
      return true;
    }
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: () => {
      resolvePersisted();
      return false;
    }
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger,
    analyze: async () => ({ bpm: 120, firstBeatSeconds: 0.2, confidence: 0.8 })
  });

  scheduler.sync();
  await persisted;
  await scheduler.stop();

  assert.equal(applyCalls, 0);
});

test('faixa desabilitada não entra no processamento rítmico', async () => {
  const current = track();
  let analyzeCalls = 0;

  const library = {
    allTracks: [current],
    getTrack: () => undefined,
    applyRhythmAnalysis: () => false
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: () => true
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger,
    analyze: async () => {
      analyzeCalls += 1;
      return { bpm: 120, firstBeatSeconds: 0.2, confidence: 0.8 };
    }
  });

  scheduler.sync();
  await new Promise<void>(resolve => setImmediate(resolve));
  await scheduler.stop();

  assert.equal(analyzeCalls, 0);
});
