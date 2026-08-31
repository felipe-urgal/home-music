import type { AdminScanTrigger, ScanResponse } from '@home-music/shared';
import { buildAdminLibraryOverview } from './admin-library-overview.js';
import { runScanWithHistory } from './admin-operation-history-scan.js';
import type { AdminOperationHistoryStore } from './admin-operation-history.js';
import type { HomeMusicDatabase } from './database.js';
import type { PromotedImportFile } from './import-staging.js';
import {
  auditLibraryIntegrity,
  indexLibraryFile,
  mergeIndexedTrack,
  scanLibrary,
  type IndexedTrack
} from './library.js';
import { LibraryMutationLock } from './library-mutation-lock.js';
import { resolveLibraryRoot } from './security.js';
import type { TrackAvailabilityStore } from './track-availability-store.js';

type ServiceLogger = {
  warn: (bindings: object, message: string) => void;
  info: (bindings: object, message: string) => void;
  error: (bindings: object, message: string) => void;
};

type LibraryServiceOptions = {
  musicDir: string;
  autoRescanIntervalSeconds: number;
  database: HomeMusicDatabase;
  trackAvailability: TrackAvailabilityStore;
  operationHistory: AdminOperationHistoryStore;
  logger: ServiceLogger;
};

export class LibraryService {
  private tracks: IndexedTrack[] = [];
  private tracksById = new Map<string, IndexedTrack>();
  private libraryRoot = '';
  private libraryReady = false;
  private libraryRevision = 0;
  private scannedAt = new Date(0).toISOString();
  private scanPromise: Promise<ScanResponse> | null = null;
  private readonly mutations = new LibraryMutationLock();
  private invalidateMediaCache: () => void = () => undefined;

  constructor(private readonly options: LibraryServiceOptions) {}

  setMediaCacheInvalidator(invalidate: () => void) {
    this.invalidateMediaCache = invalidate;
  }

  get ready() {
    return this.libraryReady;
  }

  get root() {
    return this.libraryRoot;
  }

  get scanning() {
    return Boolean(this.scanPromise);
  }

  get allTracks() {
    return this.tracks;
  }

  get enabledTrackCount() {
    return this.tracksById.size;
  }

  getTrack(trackId: string) {
    return this.tracksById.get(trackId);
  }

  publicTrack(track: IndexedTrack) {
    const {
      filePath: _filePath,
      mimeType: _mimeType,
      fileSize: _fileSize,
      mtimeMs: _mtimeMs,
      ...safe
    } = track;
    return safe;
  }

  listPublicTracks() {
    return [...this.tracksById.values()].map(track => this.publicTrack(track));
  }

  cleanTrackIds(value: unknown) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .filter((item): item is string => typeof item === 'string' && item.length <= 64)
      .filter(id => this.tracksById.has(id))
    )].slice(0, 5000);
  }

  automaticRescanStatus() {
    const enabled = Boolean(this.options.musicDir) && this.options.autoRescanIntervalSeconds > 0;
    return {
      enabled,
      intervalSeconds: enabled ? this.options.autoRescanIntervalSeconds : null
    };
  }

  status() {
    return {
      scannedAt: this.scannedAt,
      scanning: this.scanning,
      revision: this.libraryRevision,
      autoRescan: this.automaticRescanStatus()
    };
  }

  overview(integrity?: Awaited<ReturnType<typeof auditLibraryIntegrity>>) {
    return buildAdminLibraryOverview(this.tracks, {
      ready: this.libraryReady,
      scanning: this.scanning,
      scannedAt: this.scannedAt,
      autoRescan: this.automaticRescanStatus()
    }, integrity ? { integrity } : undefined);
  }

  async checkIntegrity() {
    if (!this.options.musicDir || !this.libraryReady) return null;
    const resolvedRoot = await resolveLibraryRoot(this.options.musicDir);
    const integrity = await auditLibraryIntegrity(resolvedRoot, this.tracks, (message, error) => {
      this.options.logger.warn({ err: error }, message);
    });
    return this.overview(integrity);
  }

  listAdminTracks() {
    return this.tracks.map(track => ({
      ...this.publicTrack(track),
      enabled: this.options.trackAvailability.isEnabled(track.id)
    }));
  }

  setTrackEnabled(trackId: string, enabled: boolean) {
    const track = this.tracks.find(item => item.id === trackId);
    if (!track) return null;

    const currentEnabled = this.options.trackAvailability.isEnabled(trackId);
    if (currentEnabled !== enabled) {
      this.options.trackAvailability.setEnabled(trackId, enabled);
      this.setTracks(this.tracks);
      this.libraryRevision += 1;
      if (!enabled) this.invalidateMediaCache();
    }

    return { ...this.publicTrack(track), enabled };
  }

  setTrackLocation(trackId: string, location: { absolutePath: string; folder: string; folderPath: string }) {
    const index = this.tracks.findIndex(item => item.id === trackId);
    if (index < 0) return null;

    const updated: IndexedTrack = {
      ...this.tracks[index],
      filePath: location.absolutePath,
      folder: location.folder,
      folderPath: location.folderPath
    };
    const nextTracks = [...this.tracks];
    nextTracks[index] = updated;
    this.setTracks(nextTracks);
    this.invalidateMediaCache();
    return {
      ...this.publicTrack(updated),
      enabled: this.options.trackAvailability.isEnabled(trackId)
    };
  }

  async initialize() {
    if (!this.options.musicDir) {
      this.setTracks([]);
      this.libraryReady = false;
      return;
    }

    const resolvedRoot = await resolveLibraryRoot(this.options.musicDir);
    const storedRoot = this.options.database.getMetadata('libraryRoot');
    const storedScannedAt = this.options.database.getMetadata('scannedAt');

    if (storedRoot === resolvedRoot && storedScannedAt) {
      this.libraryRoot = resolvedRoot;
      this.scannedAt = storedScannedAt;
      this.setTracks(this.options.database.loadTracks());
      this.libraryReady = true;
      return;
    }

    await this.rescan();
  }

  rescan(trigger?: AdminScanTrigger) {
    if (this.scanPromise) return this.scanPromise;

    const run = trigger
      ? () => runScanWithHistory(
          this.options.operationHistory,
          trigger,
          () => this.performRescan(),
          error => this.options.logger.warn(
            { err: error, trigger },
            'Falha ao persistir histórico do scan.'
          )
        )
      : () => this.performRescan();

    this.scanPromise = run()
      .catch(error => {
        this.libraryReady = false;
        throw error;
      })
      .finally(() => {
        this.scanPromise = null;
      });
    return this.scanPromise;
  }

  waitForCurrentScan() {
    return this.scanPromise ?? Promise.resolve();
  }

  async updateForPromotedImport(promoted: PromotedImportFile, jobId: string) {
    await this.mutations.run(async () => {
      try {
        if (!this.options.musicDir) {
          throw new Error('MUSIC_DIR não está configurado para indexação incremental.');
        }
        const resolvedRoot = await resolveLibraryRoot(this.options.musicDir);
        if (!this.libraryReady || this.libraryRoot !== resolvedRoot) {
          throw new Error('Snapshot atual da biblioteca não está pronto para atualização incremental.');
        }

        const existing = this.tracks.find(track => track.filePath === promoted.absolutePath);
        const indexed = await indexLibraryFile(
          resolvedRoot,
          promoted.absolutePath,
          existing?.id,
          (message, error) => this.options.logger.warn({ err: error, importJobId: jobId }, message)
        );
        const nextTracks = mergeIndexedTrack(this.tracks, indexed);
        const nextScannedAt = new Date().toISOString();

        this.options.database.syncTracks(nextTracks, resolvedRoot, nextScannedAt);
        this.applySnapshot(nextTracks, resolvedRoot, nextScannedAt, true);
        this.options.logger.info(
          { importJobId: jobId, trackId: indexed.id, relativePath: promoted.relativePath },
          'Importação adicionada à biblioteca incrementalmente.'
        );
      } catch (incrementalError) {
        this.options.logger.warn(
          { err: incrementalError, importJobId: jobId, relativePath: promoted.relativePath },
          'Indexação incremental da importação falhou; executando rescan completo.'
        );
        try {
          const result = await this.performRescanUnlocked();
          this.options.logger.info(
            {
              importJobId: jobId,
              added: result.added,
              updated: result.updated,
              removed: result.removed,
              tracks: result.tracks
            },
            'Biblioteca reconciliada após fallback da importação.'
          );
        } catch (fallbackError) {
          this.libraryReady = false;
          this.options.logger.error(
            {
              err: fallbackError,
              incrementalError,
              importJobId: jobId,
              relativePath: promoted.relativePath
            },
            'Arquivo importado foi promovido, mas a biblioteca não pôde ser reconciliada; o próximo rescan tentará recuperá-lo.'
          );
        }
      }
    });
  }

  private setTracks(nextTracks: IndexedTrack[]) {
    this.tracks = nextTracks;
    this.tracksById = new Map(
      nextTracks
        .filter(track => this.options.trackAvailability.isEnabled(track.id))
        .map(track => [track.id, track])
    );
  }

  private applySnapshot(
    nextTracks: IndexedTrack[],
    resolvedRoot: string,
    nextScannedAt: string,
    changed: boolean
  ) {
    this.libraryRoot = resolvedRoot;
    this.scannedAt = nextScannedAt;
    this.setTracks(nextTracks);
    this.libraryReady = true;

    try {
      this.options.trackAvailability.refresh();
      this.setTracks(nextTracks);
    } catch (error) {
      this.options.logger.warn(
        { err: error },
        'Não foi possível atualizar o cache de disponibilidade das faixas.'
      );
    }

    if (changed) {
      this.libraryRevision += 1;
      this.invalidateMediaCache();
    }
  }

  private performRescan() {
    return this.mutations.run(() => this.performRescanUnlocked());
  }

  private async performRescanUnlocked(): Promise<ScanResponse> {
    if (!this.options.musicDir) {
      const hadTracks = this.tracks.length > 0;
      this.setTracks([]);
      this.libraryRoot = '';
      this.libraryReady = false;
      this.scannedAt = new Date().toISOString();
      if (hadTracks) {
        this.libraryRevision += 1;
        this.invalidateMediaCache();
      }
      return {
        tracks: 0,
        scannedAt: this.scannedAt,
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0
      };
    }

    const resolvedRoot = await resolveLibraryRoot(this.options.musicDir);
    const rootChanged = this.libraryRoot !== resolvedRoot;
    const previous = rootChanged ? [] : this.tracks;
    const result = await scanLibrary(resolvedRoot, previous, (message, error) => {
      this.options.logger.warn({ err: error }, message);
    });
    const nextScannedAt = new Date().toISOString();
    const changed = rootChanged
      || result.stats.added > 0
      || result.stats.updated > 0
      || result.stats.removed > 0;

    this.options.database.syncTracks(result.tracks, resolvedRoot, nextScannedAt);
    this.applySnapshot(result.tracks, resolvedRoot, nextScannedAt, changed);

    return {
      tracks: this.tracksById.size,
      scannedAt: this.scannedAt,
      ...result.stats
    };
  }
}
