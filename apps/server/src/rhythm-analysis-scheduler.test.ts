import assert from 'node:assert/strict';
import test from 'node:test';
import type { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import type { LibraryService } from './library-service.js';
import { RhythmAnalysisScheduler } from './rhythm-analysis-scheduler.js';
import { RhythmAnalysisUnavailableError } from './rhythm-analysis.js';

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


test('falha determinística de decode é persistida como indisponível e não entra novamente na fila', async () => {
  let current = track();
  let analyzeCalls = 0;
  let saveCalls = 0;
  const warnings: Array<{ bindings: object; message: string }> = [];
  let resolveApplied!: () => void;
  const applied = new Promise<void>(resolve => {
    resolveApplied = resolve;
  });

  const library = {
    allTracks: [current],
    getTrack: (trackId: string) => trackId === current.id ? current : undefined,
    applyRhythmAnalysis: (
      _trackId: string,
      _sourceFileSize: number,
      _sourceMtimeMs: number,
      rhythm: IndexedTrack['rhythm'] | null
    ) => {
      assert.equal(rhythm, null);
      current = { ...current, rhythmAnalysisCurrent: true };
      resolveApplied();
      return true;
    }
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: (
      _trackId: string,
      _size: number,
      _mtime: number,
      rhythm: null
    ) => {
      saveCalls += 1;
      assert.equal(rhythm, null);
      return true;
    }
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger: {
      warn: (bindings, message) => warnings.push({ bindings, message })
    },
    analyze: async () => {
      analyzeCalls += 1;
      throw new RhythmAnalysisUnavailableError(1);
    }
  });

  scheduler.sync();
  await applied;
  scheduler.sync();
  await new Promise<void>(resolve => setImmediate(resolve));
  await scheduler.stop();

  assert.equal(analyzeCalls, 1);
  assert.equal(saveCalls, 1);
  assert.equal(scheduler.runtime.completed, 1);
  assert.equal(scheduler.runtime.unavailable, 1);
  assert.equal(scheduler.runtime.decodeUnavailable, 1);
  assert.equal(scheduler.runtime.failed, 0);
  assert.equal(warnings.length, 1);
  assert.deepEqual(
    Object.keys(warnings[0]?.bindings ?? {}).sort(),
    ['exitCode', 'reason', 'trackId']
  );
  assert.deepEqual(warnings[0]?.bindings, {
    trackId: current.id,
    reason: 'ffmpeg-decode-failed',
    exitCode: 1
  });
});

test('resultado sem ritmo é marcado como concluído e não entra novamente na fila', async () => {
  let current = track();
  let analyzeCalls = 0;
  let resolveApplied!: () => void;
  const applied = new Promise<void>(resolve => {
    resolveApplied = resolve;
  });

  const library = {
    allTracks: [current],
    getTrack: (trackId: string) => trackId === current.id ? current : undefined,
    applyRhythmAnalysis: () => {
      current = { ...current, rhythmAnalysisCurrent: true };
      resolveApplied();
      return true;
    }
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: (
      _trackId: string,
      _size: number,
      _mtime: number,
      rhythm: null
    ) => {
      assert.equal(rhythm, null);
      return true;
    }
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger,
    analyze: async () => {
      analyzeCalls += 1;
      return null;
    }
  });

  scheduler.sync();
  await applied;
  scheduler.sync();
  await new Promise<void>(resolve => setImmediate(resolve));
  await scheduler.stop();

  assert.equal(analyzeCalls, 1);
});


test('runtime agrega fila, resultados, baixa confiança, falhas e timeout sem expor paths', async () => {
  const tracks = new Map<string, IndexedTrack>([
    ['detected', { ...track(), id: 'detected' }],
    ['low-confidence', { ...track(), id: 'low-confidence' }],
    ['unavailable', { ...track(), id: 'unavailable' }],
    ['timeout', { ...track(), id: 'timeout' }]
  ]);

  const library = {
    allTracks: Array.from(tracks.values()),
    getTrack: (trackId: string) => tracks.get(trackId),
    applyRhythmAnalysis: (
      trackId: string,
      _sourceFileSize: number,
      _sourceMtimeMs: number,
      rhythm: IndexedTrack['rhythm'] | null
    ) => {
      const current = tracks.get(trackId);
      if (!current) return false;
      tracks.set(trackId, { ...current, rhythm: rhythm ?? undefined, rhythmAnalysisCurrent: true });
      return true;
    }
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: () => true
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger,
    analyze: async current => {
      if (current.id === 'timeout') throw new Error('FFmpeg excedeu o timeout da análise rítmica.');
      if (current.id === 'unavailable') return null;
      if (current.id === 'low-confidence') {
        return { bpm: 120, firstBeatSeconds: 0.2, confidence: 0.4 };
      }
      return { bpm: 128, firstBeatSeconds: 0.3, confidence: 0.9 };
    }
  });

  scheduler.sync();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runtime = scheduler.runtime;
    if (runtime.completed + runtime.failed === 4) break;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  await scheduler.stop();

  assert.deepEqual(
    {
      pending: scheduler.runtime.pending,
      active: scheduler.runtime.active,
      completed: scheduler.runtime.completed,
      detected: scheduler.runtime.detected,
      unavailable: scheduler.runtime.unavailable,
      decodeUnavailable: scheduler.runtime.decodeUnavailable,
      failed: scheduler.runtime.failed,
      timeouts: scheduler.runtime.timeouts,
      lowConfidence: scheduler.runtime.lowConfidence,
      analyzerVersion: scheduler.runtime.analyzerVersion
    },
    {
      pending: 0,
      active: 0,
      completed: 3,
      detected: 2,
      unavailable: 1,
      decodeUnavailable: 0,
      failed: 1,
      timeouts: 1,
      lowConfidence: 1,
      analyzerVersion: 2
    }
  );
  assert.ok(scheduler.runtime.averageDurationMs != null);
  assert.ok(scheduler.runtime.lastDurationMs != null);
});


test('scheduler reutilizado gera waveform sem refazer ritmo já atual', async () => {
  let current: IndexedTrack = {
    ...track(),
    rhythm: { bpm: 120, firstBeatSeconds: 0.2, confidence: 0.9 },
    rhythmAnalysisCurrent: true
  };
  let rhythmCalls = 0;
  let waveformCalls = 0;
  let saveWaveformCalls = 0;
  let resolveApplied!: () => void;
  const applied = new Promise<void>(resolve => { resolveApplied = resolve; });

  const library = {
    allTracks: [current],
    getTrack: (trackId: string) => trackId === current.id ? current : undefined,
    applyRhythmAnalysis: () => {
      throw new Error('ritmo não deveria ser recalculado');
    },
    applyWaveformAnalysis: () => {
      current = { ...current, waveformAnalysisCurrent: true };
      resolveApplied();
      return true;
    }
  } as unknown as LibraryService;

  const database = {
    saveTrackRhythmAnalysis: () => {
      throw new Error('ritmo não deveria ser persistido novamente');
    },
    saveTrackWaveformAnalysis: () => {
      saveWaveformCalls += 1;
      return true;
    }
  } as unknown as HomeMusicDatabase;

  const scheduler = new RhythmAnalysisScheduler({
    library,
    database,
    logger,
    analyze: async () => {
      rhythmCalls += 1;
      return { bpm: 120, firstBeatSeconds: 0.2, confidence: 0.9 };
    },
    analyzeWaveform: async () => {
      waveformCalls += 1;
      return { version: 1, durationSeconds: 180, peaks: [0, 0.5, 1] };
    }
  });

  scheduler.sync();
  await applied;
  scheduler.sync();
  await new Promise<void>(resolve => setImmediate(resolve));
  await scheduler.stop();

  assert.equal(rhythmCalls, 0);
  assert.equal(waveformCalls, 1);
  assert.equal(saveWaveformCalls, 1);
  assert.equal(scheduler.runtime.waveformCompleted, 1);
  assert.equal(scheduler.runtime.waveformAvailable, 1);
  assert.equal(scheduler.runtime.waveformFailed, 0);
});
