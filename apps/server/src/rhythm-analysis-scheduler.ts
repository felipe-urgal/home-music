import type { TrackRhythm } from '@home-music/shared';
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

export class RhythmAnalysisScheduler {
  private readonly pending = new Set<string>();
  private readonly controller = new AbortController();
  private drainPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(private readonly options: RhythmAnalysisSchedulerOptions) {}

  sync(tracks: readonly IndexedTrack[] = this.options.library.allTracks) {
    if (this.stopped) return;
    for (const track of tracks) {
      const enabledTrack = this.options.library.getTrack(track.id);
      if (enabledTrack && !enabledTrack.rhythm) this.pending.add(track.id);
    }
    this.ensureDrain();
  }

  enqueue(trackId: string) {
    if (this.stopped) return;
    const track = this.options.library.getTrack(trackId);
    if (!track || track.rhythm) return;
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
      if (!track || track.rhythm) continue;

      const sourceFileSize = track.fileSize;
      const sourceMtimeMs = track.mtimeMs;

      try {
        const rhythm = await this.options.analyze(track, this.controller.signal);
        if (!rhythm || this.stopped) continue;

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
          this.options.logger.warn(
            { err: error, trackId },
            'Análise rítmica da faixa falhou; reprodução continuará sem sincronização por BPM.'
          );
        }
      }

      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}
