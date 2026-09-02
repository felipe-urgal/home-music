import { open } from 'node:fs/promises';
import type { NormalizationMode } from '@home-music/shared';
import type { FfmpegStatus } from './ffmpeg.js';
import { HeavyWorkQueue, type HeavyWorkQueueRuntime } from './heavy-work-queue.js';
import type { LibraryService } from './library-service.js';
import { readCover } from './library.js';
import { readTrackLyrics } from './lyrics.js';
import { replayGainForMode } from './replay-gain.js';
import {
  openRegularFileInside,
  UnsafeLibraryPathError
} from './security.js';
import type { TranscodeCacheMaintenance } from './transcode-cache-maintenance.js';
import { TranscodeExecutionError, type TranscodeManager, type TranscodeQuality } from './transcoding.js';

const MAX_COVER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_COVER_CACHE_ITEMS = 64;

type CachedCover = {
  data: Buffer;
  format: string;
  size: number;
  mtimeMs: number;
};

type TrackMediaInfrastructureOptions = {
  library: LibraryService;
  transcodeManager: TranscodeManager;
  transcodeCacheMaintenance: TranscodeCacheMaintenance;
  getFfmpegStatus: () => FfmpegStatus;
  coverQueue?: {
    maxConcurrent: number;
    maxPending: number;
    maxPendingPerOwner: number;
    retryAfterSeconds: number;
  };
};

export class TrackMediaInfrastructure {
  private coverCacheBytes = 0;
  private readonly coverCache = new Map<string, CachedCover>();
  private readonly coverQueue: HeavyWorkQueue;

  constructor(private readonly options: TrackMediaInfrastructureOptions) {
    const queue = options.coverQueue ?? {
      maxConcurrent: 4,
      maxPending: 32,
      maxPendingPerOwner: 8,
      retryAfterSeconds: 2
    };
    this.coverQueue = new HeavyWorkQueue({ name: 'cover', ...queue });
  }

  clearCoverCache() {
    this.coverCache.clear();
    this.coverCacheBytes = 0;
  }

  get ffmpegAvailable() {
    return this.options.getFfmpegStatus().available;
  }

  get coverQueueRuntime(): HeavyWorkQueueRuntime {
    return this.coverQueue.runtime;
  }

  async lyrics(trackId: string) {
    const track = this.options.library.getTrack(trackId);
    const root = this.options.library.root;
    if (!track || !root) return null;
    return readTrackLyrics(root, track.filePath);
  }

  async cover(trackId: string) {
    const track = this.options.library.getTrack(trackId);
    const root = this.options.library.root;
    if (!track?.hasCover || !root) return null;

    return this.coverQueue.run(async () => {
      try {
        const opened = await openRegularFileInside(root, track.filePath);
        const cached = this.getCachedCover(track.id, opened.stat.size, opened.stat.mtimeMs);

        if (cached) {
          await opened.handle.close();
          return { data: cached.data, format: cached.format };
        }

        const stream = opened.handle.createReadStream({ autoClose: true });
        const cover = await readCover(stream, track.mimeType);
        stream.destroy();
        if (!cover) return null;

        const data = Buffer.from(cover.data);
        this.cacheCover(track.id, {
          data,
          format: cover.format,
          size: opened.stat.size,
          mtimeMs: opened.stat.mtimeMs
        });
        return { data, format: cover.format };
      } catch (error) {
        if (isNotFoundLike(error)) return null;
        throw error;
      }
    });
  }

  async openTrack(trackId: string) {
    const track = this.options.library.getTrack(trackId);
    const root = this.options.library.root;
    if (!track || !root) return null;

    try {
      return {
        track,
        opened: await openRegularFileInside(root, track.filePath)
      };
    } catch (error) {
      if (isNotFoundLike(error)) return null;
      throw error;
    }
  }

  async prepareTranscode(
    trackId: string,
    quality: TranscodeQuality,
    normalization: NormalizationMode
  ) {
    const track = this.options.library.getTrack(trackId);
    const root = this.options.library.root;
    if (!track || !root) return null;

    const gainDb = replayGainForMode(track, normalization);
    try {
      const { prepared, transcoded } = await this.options.transcodeCacheMaintenance.withTranscode(async () => {
        const inspected = await openRegularFileInside(root, track.filePath);
        const sourceSize = inspected.stat.size;
        const sourceMtimeMs = inspected.stat.mtimeMs;
        await inspected.handle.close();

        const prepared = await this.options.transcodeManager.prepare({
          trackId: track.id,
          sourceSize,
          sourceMtimeMs,
          quality,
          normalizationGainDb: gainDb,
          createInput: async () => {
            const source = await openRegularFileInside(root, track.filePath);
            if (source.stat.size !== sourceSize || source.stat.mtimeMs !== sourceMtimeMs) {
              await source.handle.close().catch(() => undefined);
              throw new TranscodeExecutionError(
                'failed',
                'O arquivo de origem mudou enquanto aguardava o transcoding.'
              );
            }
            return source.handle.createReadStream({ autoClose: true });
          }
        });
        return {
          prepared,
          transcoded: await open(prepared.path, 'r')
        };
      });

      return { track, prepared, transcoded, gainDb };
    } catch (error) {
      if (isNotFoundLike(error)) return null;
      throw error;
    }
  }

  private getCachedCover(trackId: string, size: number, mtimeMs: number) {
    const cached = this.coverCache.get(trackId);
    if (!cached || cached.size !== size || cached.mtimeMs !== mtimeMs) {
      if (cached) {
        this.coverCacheBytes -= cached.data.byteLength;
        this.coverCache.delete(trackId);
      }
      return undefined;
    }

    this.coverCache.delete(trackId);
    this.coverCache.set(trackId, cached);
    return cached;
  }

  private cacheCover(trackId: string, cover: CachedCover) {
    if (cover.data.byteLength > MAX_COVER_CACHE_BYTES) return;

    const previous = this.coverCache.get(trackId);
    if (previous) this.coverCacheBytes -= previous.data.byteLength;
    this.coverCache.delete(trackId);

    this.coverCache.set(trackId, cover);
    this.coverCacheBytes += cover.data.byteLength;

    while (
      this.coverCache.size > MAX_COVER_CACHE_ITEMS
      || this.coverCacheBytes > MAX_COVER_CACHE_BYTES
    ) {
      const oldestKey = this.coverCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.coverCache.get(oldestKey);
      if (oldest) this.coverCacheBytes -= oldest.data.byteLength;
      this.coverCache.delete(oldestKey);
    }
  }
}

function isNotFoundLike(error: unknown) {
  if (error instanceof UnsafeLibraryPathError) return true;
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP';
}