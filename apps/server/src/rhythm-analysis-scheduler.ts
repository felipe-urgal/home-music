import { MIN_RHYTHM_CONFIDENCE, type TrackRhythm } from '@home-music/shared';
import { RHYTHM_ANALYZER_VERSION, RhythmAnalysisUnavailableError } from './rhythm-analysis.js';
import type { HomeMusicDatabase } from './database.js';
import type { IndexedTrack } from './library.js';
import type { LibraryService } from './library-service.js';

type SchedulerLogger = {
  warn: (bindings: object, message: string) => void;
};

export type RhythmTrackAnalyzer = (
  track: IndexedTrack,
  signal: AbortSignal
) => Promise<TrackRhythm | null>;

type RhythmAnalysisSchedulerOptions = {
  library: LibraryService;
  database: HomeMusicDatabase;
  analyze: RhythmTrackAnalyzer;
  logger: SchedulerLogger;
};

export type RhythmAnalysisRuntime = {
  pending: number;
  active: number;
  completed: number;
  detected: number;
  unavailable: number;
  decodeUnavailable: number;
  failed: number;
  timeouts: number;
  lowConfidence: number;
  averageDurationMs: number | null;
  lastDurationMs: number | null;
  analyzerVersion: number;
};

function isTimeoutError(error: unknown) {
  return error instanceof Error && /timeout/i.test(error.message);
}

export class RhythmAnalysisScheduler {
  private readonly pending = new Set<string>();
  private readonly controller = new AbortController();
  private drainPromise: Promise<void> | null = null;
  private stopped = false;
  private active = 0;
  private completed = 0;
  private detected = 0;
  private unavailable = 0;
  private decodeUnavailable = 0;
  private failed = 0;
  private timeouts = 0;
  private lowConfidence = 0;
  private totalDurationMs = 0;
  private lastDurationMs: number | null = null;

  constructor(private readonly options: RhythmAnalysisSchedulerOptions) {}

  get runtime(): RhythmAnalysisRuntime {
    const attempts = this.completed + this.failed;
    return {
      pending: this.pending.size,
      active: this.active,
      completed: this.completed,
      detected: this.detected,
      unavailable: this.unavailable,
      decodeUnavailable: this.decodeUnavailable,
      failed: this.failed,
      timeouts: this.timeouts,
      lowConfidence: this.lowConfidence,
      averageDurationMs: attempts > 0
        ? Number((this.totalDurationMs / attempts).toFixed(2))
        : null,
      lastDurationMs: this.lastDurationMs == null
        ? null
        : Number(this.lastDurationMs.toFixed(2)),
      analyzerVersion: RHYTHM_ANALYZER_VERSION
    };
  }

  sync(tracks: readonly IndexedTrack[] = this.options.library.allTracks) {
    if (this.stopped) return;
    for (const track of tracks) {
      const enabledTrack = this.options.library.getTrack(track.id);
      if (enabledTrack && !enabledTrack.rhythmAnalysisCurrent) this.pending.add(track.id);
    }
    this.ensureDrain();
  }

  enqueue(trackId: string) {
    if (this.stopped) return;
    const track = this.options.library.getTrack(trackId);
    if (!track || track.rhythmAnalysisCurrent) return;
    this.pending.add(trackId);
    this.ensureDrain();
  }

  async stop() {
    if (this.stopped) {
      await this.drainPromise;
      return;
    }
    this.stopped = true;
    this.pending.clear();
    this.controller.abort();
    await this.drainPromise;
  }

  private ensureDrain() {
    if (this.stopped || this.drainPromise || this.pending.size === 0) return;
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (!this.stopped && this.pending.size > 0) this.ensureDrain();
    });
  }

  private async drain() {
    while (!this.stopped && this.pending.size > 0) {
      const trackId = this.pending.values().next().value as string | undefined;
      if (!trackId) return;
      this.pending.delete(trackId);

      const track = this.options.library.getTrack(trackId);
      if (!track || track.rhythmAnalysisCurrent) continue;

      const sourceFileSize = track.fileSize;
      const sourceMtimeMs = track.mtimeMs;

      const startedAt = performance.now();
      this.active += 1;
      try {
        let rhythm: TrackRhythm | null;
        try {
          rhythm = await this.options.analyze(track, this.controller.signal);
        } catch (error) {
          if (!(error instanceof RhythmAnalysisUnavailableError)) throw error;
          rhythm = null;
          this.decodeUnavailable += 1;
          this.options.logger.warn(
            {
              trackId,
              reason: error.reason,
              exitCode: error.exitCode
            },
            'FFmpeg não conseguiu decodificar a faixa; análise rítmica marcada como indisponível para a assinatura atual.'
          );
        }

        this.completed += 1;
        if (rhythm) {
          this.detected += 1;
          if (rhythm.confidence < MIN_RHYTHM_CONFIDENCE) this.lowConfidence += 1;
        } else {
          this.unavailable += 1;
        }
        if (this.stopped) continue;

        const persisted = this.options.database.saveTrackRhythmAnalysis(
          track.id,
          sourceFileSize,
          sourceMtimeMs,
          rhythm
        );
        if (!persisted) continue;

        this.options.library.applyRhythmAnalysis(
          track.id,
          sourceFileSize,
          sourceMtimeMs,
          rhythm
        );
      } catch (error) {
        if (!this.controller.signal.aborted) {
          this.failed += 1;
          if (isTimeoutError(error)) this.timeouts += 1;
          this.options.logger.warn(
            { err: error, trackId },
            'Análise rítmica da faixa falhou; reprodução continuará sem sincronização por BPM.'
          );
        }
      } finally {
        const durationMs = Math.max(0, performance.now() - startedAt);
        this.totalDurationMs += durationMs;
        this.lastDurationMs = durationMs;
        this.active = Math.max(0, this.active - 1);
      }

      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}
