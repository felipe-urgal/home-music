import { open } from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { NormalizationMode } from '@home-music/shared';
import type { FfmpegStatus } from './ffmpeg.js';
import type { LibraryService } from './library-service.js';
import { readCover } from './library.js';
import { readTrackLyrics } from './lyrics.js';
import { replayGainForMode } from './replay-gain.js';
import {
  openRegularFileInside,
  UnsafeLibraryPathError
} from './security.js';
import type { TranscodeCacheMaintenance } from './transcode-cache-maintenance.js';
import type { TranscodeManager, TranscodeQuality } from './transcoding.js';

const MAX_COVER_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_COVER_CACHE_ITEMS = 64;
const MAX_CONCURRENT_COVER_REQUESTS = 4;

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
  logger: FastifyBaseLogger;
};

export class TrackMediaInfrastructure {
  private coverCacheBytes = 0;
  private activeCoverRequests = 0;
  private readonly coverWaiters: Array<() => void> = [];
  private readonly coverCache = new Map<string, CachedCover>();

  constructor(private readonly options: TrackMediaInfrastructureOptions) {}

  clearCoverCache() {
    this.coverCache.clear();
    this.coverCacheBytes = 0;
  }

  get ffmpegAvailable() {
    return this.options.getFfmpegStatus().available;
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

    return this.withCoverRequestSlot(async () => {
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
        const source = await openRegularFileInside(root, track.filePath);
        let prepared;
        try {
          prepared = await this.options.transcodeManager.prepare({
            trackId: track.id,
            sourceSize: source.stat.size,
            sourceMtimeMs: source.stat.mtimeMs,
            quality,
            normalizationGainDb: gainDb,
            createInput: () => source.handle.createReadStream({ autoClose: false })
          });
        } finally {
          await source.handle.close().catch(() => undefined);
        }
        return {
          prepared,
          transcoded: await open(prepared.path, 'r')
        };
      });

      return { track, prepared, transcoded, gainDb };
    } catch (error) {
      if (isNotFoundLike(error)) return null;
      this.options.logger.warn(
        { err: error, trackId: track.id, quality, normalization },
        'Falha ao preparar mídia da faixa.'
      );
      throw error;
    }
  }

  private async withCoverRequestSlot<T>(operation: () => Promise<T>) {
    if (this.activeCoverRequests >= MAX_CONCURRENT_COVER_REQUESTS) {
      await new Promise<void>(resolve => this.coverWaiters.push(resolve));
    }

    this.activeCoverRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeCoverRequests -= 1;
      this.coverWaiters.shift()?.();
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
