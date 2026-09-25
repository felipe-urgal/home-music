import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import type { LibraryService } from './library-service.js';
import { RhythmAnalysisScheduler } from './rhythm-analysis-scheduler.js';

const DEFAULT_TRACK_COUNT = 2_000;
const TRACK_COUNT = positiveInteger(
  process.env.HOME_MUSIC_BENCHMARK_RHYTHM_TRACKS,
  DEFAULT_TRACK_COUNT
);
const SCALE = Math.max(1, TRACK_COUNT / DEFAULT_TRACK_COUNT);
const MAX_CURRENT_SYNC_MS = 1_000 * SCALE;
const MAX_BACKLOG_SYNC_MS = 1_500 * SCALE;
const MAX_BACKLOG_DRAIN_MS = 20_000 * SCALE;
const MAX_HEAP_DELTA_MB = 256 * SCALE;
const MEBIBYTE = 1024 * 1024;

function positiveInteger(raw: string | undefined, fallback: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function mb(bytes: number) {
  return round(bytes / MEBIBYTE);
}

function syntheticTrack(index: number, rhythmAnalysisCurrent: boolean): IndexedTrack {
  return {
    id: `track-${index.toString().padStart(5, '0')}`,
    title: `Faixa ${index}`,
    artist: 'Artista',
    album: 'Álbum',
    albumArtist: 'Artista',
    folder: 'Benchmark',
    folderPath: 'Benchmark',
    duration: 180,
    format: 'MP3',
    hasCover: false,
    replayGainTrackDb: null,
    replayGainAlbumDb: null,
    filePath: `/benchmark/track-${index}.mp3`,
    mimeType: 'audio/mpeg',
    fileSize: 1_000 + index,
    mtimeMs: 1_700_000_000_000 + index,
    rhythmAnalysisCurrent
  };
}

function createLibrary(tracks: IndexedTrack[]) {
  const current = new Map(tracks.map(track => [track.id, track]));

  return {
    service: {
      allTracks: tracks,
      getTrack: (trackId: string) => current.get(trackId),
      applyRhythmAnalysis: (
        trackId: string,
        _sourceFileSize: number,
        _sourceMtimeMs: number
      ) => {
        const track = current.get(trackId);
        if (!track) return false;
        current.set(trackId, { ...track, rhythmAnalysisCurrent: true });
        return true;
      }
    } as unknown as LibraryService,
    current
  };
}

const database = {
  saveTrackRhythmAnalysis: () => true
} as unknown as HomeMusicDatabase;

const logger = {
  warn: () => undefined
};

async function waitForDrain(scheduler: RhythmAnalysisScheduler, expected: number) {
  while (scheduler.runtime.completed + scheduler.runtime.failed < expected) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

async function main() {
  const currentTracks = Array.from(
    { length: TRACK_COUNT },
    (_, index) => syntheticTrack(index, true)
  );
  const currentLibrary = createLibrary(currentTracks);
  const currentScheduler = new RhythmAnalysisScheduler({
    library: currentLibrary.service,
    database,
    logger,
    analyze: async () => {
      throw new Error('Faixa já analisada não deveria entrar no analyzer.');
    }
  });

  const currentStartedAt = performance.now();
  currentScheduler.sync();
  const currentSyncMs = performance.now() - currentStartedAt;
  assert.equal(currentScheduler.runtime.pending, 0);
  assert.equal(currentScheduler.runtime.completed, 0);
  await currentScheduler.stop();

  const backlogTracks = Array.from(
    { length: TRACK_COUNT },
    (_, index) => syntheticTrack(index, false)
  );
  const backlogLibrary = createLibrary(backlogTracks);
  const backlogScheduler = new RhythmAnalysisScheduler({
    library: backlogLibrary.service,
    database,
    logger,
    analyze: async () => null
  });

  const memoryBefore = process.memoryUsage().heapUsed;
  const backlogStartedAt = performance.now();
  backlogScheduler.sync();
  const backlogSyncMs = performance.now() - backlogStartedAt;
  const drainStartedAt = performance.now();
  await waitForDrain(backlogScheduler, TRACK_COUNT);
  const backlogDrainMs = performance.now() - drainStartedAt;
  const heapDeltaMb = mb(process.memoryUsage().heapUsed - memoryBefore);
  await backlogScheduler.stop();

  assert.equal(backlogScheduler.runtime.completed, TRACK_COUNT);
  assert.equal(backlogScheduler.runtime.unavailable, TRACK_COUNT);
  assert.equal(backlogScheduler.runtime.failed, 0);
  assert.equal(backlogScheduler.runtime.pending, 0);
  assert.equal(backlogScheduler.runtime.active, 0);

  assert.ok(
    currentSyncMs <= MAX_CURRENT_SYNC_MS,
    `sync sem backlog excedeu limite: ${round(currentSyncMs)}ms > ${round(MAX_CURRENT_SYNC_MS)}ms`
  );
  assert.ok(
    backlogSyncMs <= MAX_BACKLOG_SYNC_MS,
    `agendamento do backlog excedeu limite: ${round(backlogSyncMs)}ms > ${round(MAX_BACKLOG_SYNC_MS)}ms`
  );
  assert.ok(
    backlogDrainMs <= MAX_BACKLOG_DRAIN_MS,
    `drenagem sintética excedeu limite: ${round(backlogDrainMs)}ms > ${round(MAX_BACKLOG_DRAIN_MS)}ms`
  );
  assert.ok(
    heapDeltaMb <= MAX_HEAP_DELTA_MB,
    `heap do backlog excedeu limite: ${heapDeltaMb}MB > ${round(MAX_HEAP_DELTA_MB)}MB`
  );

  console.log(JSON.stringify({
    benchmark: 'rhythm-analysis-scheduler',
    tracks: TRACK_COUNT,
    measurements: {
      alreadyAnalyzedStartupSyncMs: round(currentSyncMs),
      backlogSchedulingSyncMs: round(backlogSyncMs),
      syntheticBacklogDrainMs: round(backlogDrainMs),
      heapDeltaMb
    },
    runtime: backlogScheduler.runtime,
    regressionLimits: {
      alreadyAnalyzedStartupSyncMs: round(MAX_CURRENT_SYNC_MS),
      backlogSchedulingSyncMs: round(MAX_BACKLOG_SYNC_MS),
      syntheticBacklogDrainMs: round(MAX_BACKLOG_DRAIN_MS),
      heapDeltaMb: round(MAX_HEAP_DELTA_MB)
    },
    note: 'O analyzer é sintético; este benchmark mede overhead do scheduler/backlog, não custo de DSP/FFmpeg.'
  }, null, 2));
}

await main();
