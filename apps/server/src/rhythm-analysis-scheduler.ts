import {
  MIN_RHYTHM_CONFIDENCE,
  type TrackRhythm,
  type TrackWaveform
} from '@home-music/shared';
import { RHYTHM_ANALYZER_VERSION, RhythmAnalysisUnavailableError } from './rhythm-analysis.js';
import {
  WAVEFORM_ANALYZER_VERSION,
  WaveformAnalysisUnavailableError
} from './waveform-analysis.js';
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

export type WaveformTrackAnalyzer = (
  track: IndexedTrack,
  signal: AbortSignal
) => Promise<TrackWaveform | null>;

type RhythmAnalysisSchedulerOptions = {
  library: LibraryService;
  database: HomeMusicDatabase;
  analyze: RhythmTrackAnalyzer;
  analyzeWaveform?: WaveformTrackAnalyzer;
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
  waveformCompleted: number;
  waveformAvailable: number;
  waveformUnavailable: number;
  waveformDecodeUnavailable: number;
  waveformFailed: number;
  waveformTimeouts: number;
  waveformAnalyzerVersion: number;
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
  private waveformCompleted = 0;
  private waveformAvailable = 0;
  private waveformUnavailable = 0;
  private waveformDecodeUnavailable = 0;
  private waveformFailed = 0;
  private waveformTimeouts = 0;
  private totalDurationMs = 0;
  private lastDurationMs: number | null = null;

  constructor(private readonly options: RhythmAnalysisSchedulerOptions) {}

  get runtime(): RhythmAnalysisRuntime {
    const attempts = this.completed + this.failed + this.waveformCompleted + this.waveformFailed;
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
      analyzerVersion: RHYTHM_ANALYZER_VERSION,
      waveformCompleted: this.waveformCompleted,
      waveformAvailable: this.waveformAvailable,
      waveformUnavailable: this.waveformUnavailable,
      waveformDecodeUnavailable: this.waveformDecodeUnavailable,
      waveformFailed: this.waveformFailed,
      waveformTimeouts: this.waveformTimeouts,
      waveformAnalyzerVersion: WAVEFORM_ANALYZER_VERSION
    };
  }

  sync(tracks: readonly IndexedTrack[] = this.options.library.allTracks) {
    if (this.stopped) return;
    for (const track of tracks) {
      const enabledTrack = this.options.library.getTrack(track.id);
      if (
        enabledTrack
        && (
          !enabledTrack.rhythmAnalysisCurrent
          || (this.options.analyzeWaveform && !enabledTrack.waveformAnalysisCurrent)
        )
      ) {
        this.pending.add(track.id);
      }
    }
    this.ensureDrain();
  }

  enqueue(trackId: string) {
    if (this.stopped) return;
    const track = this.options.library.getTrack(trackId);
    if (
      !track
      || (
        track.rhythmAnalysisCurrent
        && (!this.options.analyzeWaveform || track.waveformAnalysisCurrent)
      )
    ) return;
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

  private async analyzeRhythm(track: IndexedTrack) {
    const trackId = track.id;
    const sourceFileSize = track.fileSize;
    const sourceMtimeMs = track.mtimeMs;
    let rhythm: TrackRhythm | null;

    try {
      rhythm = await this.options.analyze(track, this.controller.signal);
    } catch (error) {
      if (!(error instanceof RhythmAnalysisUnavailableError)) throw error;
      rhythm = null;
      this.decodeUnavailable += 1;
      this.options.logger.warn(
        { trackId, reason: error.reason, exitCode: error.exitCode },
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
    if (this.stopped) return;

    const persisted = this.options.database.saveTrackRhythmAnalysis(
      trackId,
      sourceFileSize,
      sourceMtimeMs,
      rhythm
    );
    if (!persisted) return;

    this.options.library.applyRhythmAnalysis(
      trackId,
      sourceFileSize,
      sourceMtimeMs,
      rhythm
    );
  }

  private async analyzeWaveform(track: IndexedTrack) {
    const trackId = track.id;
    const sourceFileSize = track.fileSize;
    const sourceMtimeMs = track.mtimeMs;
    let waveform: TrackWaveform | null;

    try {
      const analyzeWaveform = this.options.analyzeWaveform;
      if (!analyzeWaveform) return;
      waveform = await analyzeWaveform(track, this.controller.signal);
    } catch (error) {
      if (!(error instanceof WaveformAnalysisUnavailableError)) throw error;
      waveform = null;
      this.waveformDecodeUnavailable += 1;
      this.options.logger.warn(
        { trackId, reason: error.reason, exitCode: error.exitCode },
        'FFmpeg não conseguiu decodificar a faixa; waveform marcado como indisponível para a assinatura atual.'
      );
    }

    this.waveformCompleted += 1;
    if (waveform) this.waveformAvailable += 1;
    else this.waveformUnavailable += 1;
    if (this.stopped) return;

    const persisted = this.options.database.saveTrackWaveformAnalysis(
      trackId,
      sourceFileSize,
      sourceMtimeMs,
      waveform
    );
    if (!persisted) return;

    this.options.library.applyWaveformAnalysis(
      trackId,
      sourceFileSize,
      sourceMtimeMs,
      waveform
    );
  }

  private async drain() {
    while (!this.stopped && this.pending.size > 0) {
      const trackId = this.pending.values().next().value as string | undefined;
      if (!trackId) return;
      this.pending.delete(trackId);

      const track = this.options.library.getTrack(trackId);
      if (
        !track
        || (
          track.rhythmAnalysisCurrent
          && (!this.options.analyzeWaveform || track.waveformAnalysisCurrent)
        )
      ) continue;

      const startedAt = performance.now();
      this.active += 1;

      if (!track.rhythmAnalysisCurrent && !this.stopped) {
        try {
          await this.analyzeRhythm(track);
        } catch (error) {
          if (!this.controller.signal.aborted) {
            this.failed += 1;
            if (isTimeoutError(error)) this.timeouts += 1;
            this.options.logger.warn(
              { err: error, trackId },
              'Análise rítmica da faixa falhou; reprodução continuará sem sincronização por BPM.'
            );
          }
        }
      }

      if (this.options.analyzeWaveform && !track.waveformAnalysisCurrent && !this.stopped) {
        try {
          await this.analyzeWaveform(track);
        } catch (error) {
          if (!this.controller.signal.aborted) {
            this.waveformFailed += 1;
            if (isTimeoutError(error)) this.waveformTimeouts += 1;
            this.options.logger.warn(
              { err: error, trackId },
              'Análise de waveform da faixa falhou; reprodução continuará sem waveform real.'
            );
          }
        }
      }

      const durationMs = Math.max(0, performance.now() - startedAt);
      this.totalDurationMs += durationMs;
      this.lastDurationMs = durationMs;
      this.active = Math.max(0, this.active - 1);

      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}
