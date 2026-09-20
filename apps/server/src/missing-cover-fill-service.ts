import { randomUUID } from 'node:crypto';
import type { Track } from '@home-music/shared';
import type {
  MissingCoverFillJob,
  LibraryAssistantArtworkTarget
} from '@home-music/shared/library-assistant';
import {
  downloadCoverArtArchiveImage,
  type DownloadedCoverArtArchiveImage
} from './cover-art-archive.js';
import { renderGeneratedArtworkPng } from './generated-artwork.js';
import type {
  LibraryAssistantAnalyzer,
  LibraryAssistantSuggestionDraft
} from './library-assistant-service.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import {
  inspectCoverOverride,
  type TrackCoverOverrideStore
} from './track-cover-overrides.js';

const SEARCH_BATCH_SIZE = 20;

type CoverFillLibrary = {
  listTracks: () => Track[];
};

type MissingCoverFillServiceOptions = {
  library: CoverFillLibrary;
  analyzer: LibraryAssistantAnalyzer;
  providers: LibraryAssistantProviderGateway;
  coverOverrides: TrackCoverOverrideStore;
  onArtworkChanged: () => void;
  now?: () => Date;
  createId?: () => string;
  downloadArtwork?: (
    sourceUrl: string,
    options?: { signal?: AbortSignal }
  ) => Promise<DownloadedCoverArtArchiveImage>;
  renderArtwork?: typeof renderGeneratedArtworkPng;
};

type ArtworkDraft = LibraryAssistantSuggestionDraft & {
  capability: 'artwork';
  target: LibraryAssistantArtworkTarget;
};

function isArtworkDraft(draft: LibraryAssistantSuggestionDraft): draft is ArtworkDraft {
  return draft.capability === 'artwork' && draft.target.capability === 'artwork';
}

function cloneJob(job: MissingCoverFillJob | null) {
  return job ? { ...job } : null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível preencher as capas ausentes.';
}

export class MissingCoverFillService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly downloadArtwork: NonNullable<MissingCoverFillServiceOptions['downloadArtwork']>;
  private readonly renderArtwork: typeof renderGeneratedArtworkPng;
  private job: MissingCoverFillJob | null = null;
  private controller: AbortController | null = null;
  private active: Promise<void> | null = null;

  constructor(private readonly options: MissingCoverFillServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.downloadArtwork = options.downloadArtwork
      ?? ((sourceUrl, downloadOptions) => downloadCoverArtArchiveImage(sourceUrl, downloadOptions));
    this.renderArtwork = options.renderArtwork ?? renderGeneratedArtworkPng;
  }

  getJob() {
    return cloneJob(this.job);
  }

  start() {
    if (this.job?.status === 'running') return cloneJob(this.job);

    const tracks = this.eligibleTracks();
    const startedAt = this.now().toISOString();
    this.job = {
      id: `cover-fill-${this.createId()}`,
      status: 'running',
      phase: 'searching',
      total: tracks.length,
      searched: 0,
      externalFound: 0,
      generated: 0,
      failed: 0,
      startedAt,
      finishedAt: null,
      error: null
    };

    this.controller = new AbortController();
    this.active = this.execute(tracks, this.controller.signal);
    return cloneJob(this.job);
  }

  async close() {
    this.controller?.abort();
    try {
      await this.active;
    } catch {
      // O encerramento do servidor pode interromper o preenchimento em andamento.
    }
  }

  private eligibleTracks() {
    this.options.coverOverrides.refresh();
    return this.options.library.listTracks().flatMap(track => {
      const cover = this.options.coverOverrides.getStatus(track.id);
      if (!cover || cover.physicalHasCover) return [];
      const eligible = !cover.override || this.isGeneratedOverride(track, cover.override.version);
      if (!eligible) return [];

      // Overrides gerados contam como capa efetiva na projeção. Para tentar
      // substituir o fallback por uma capa real, o analyzer precisa enxergar
      // esta faixa como ainda sem artwork.
      return [{
        ...track,
        hasCover: false,
        coverVersion: undefined
      }];
    });
  }

  private isGeneratedOverride(track: Track, version: string) {
    try {
      const generated = this.renderArtwork(track);
      return inspectCoverOverride(generated.data, generated.contentType).version === version;
    } catch {
      return false;
    }
  }

  private async execute(tracks: Track[], signal: AbortSignal) {
    let artworkChanged = false;
    try {
      const suggestions: ArtworkDraft[] = [];

      for (let offset = 0; offset < tracks.length; offset += SEARCH_BATCH_SIZE) {
        if (signal.aborted) throw new Error('Preenchimento de capas interrompido.');
        const batch = tracks.slice(offset, offset + SEARCH_BATCH_SIZE);
        try {
          const drafts = await this.options.analyzer.analyze({
            runId: this.job?.id ?? 'cover-fill',
            tracks: batch,
            signal,
            providers: this.options.providers
          });
          suggestions.push(...drafts.filter(isArtworkDraft));
        } catch {
          // Falhas externas neste lote não impedem a geração local de fallback.
        }
        if (this.job) this.job.searched = Math.min(tracks.length, offset + batch.length);
      }

      if (this.job) this.job.phase = 'applying';
      const suggestionsByUrl = new Map<string, ArtworkDraft[]>();
      for (const suggestion of suggestions) {
        const group = suggestionsByUrl.get(suggestion.target.sourceUrl) ?? [];
        group.push(suggestion);
        suggestionsByUrl.set(suggestion.target.sourceUrl, group);
      }

      const externallyCovered = new Set<string>();
      for (const [sourceUrl, group] of suggestionsByUrl) {
        if (signal.aborted) throw new Error('Preenchimento de capas interrompido.');
        let downloaded: DownloadedCoverArtArchiveImage;
        try {
          downloaded = await this.downloadArtwork(sourceUrl, { signal });
        } catch {
          continue;
        }

        for (const suggestion of group) {
          const track = tracks.find(item => item.id === suggestion.target.trackId);
          if (!track) continue;
          const status = this.options.coverOverrides.getStatus(track.id);
          if (!status || status.physicalHasCover) continue;
          if (status.override && !this.isGeneratedOverride(track, status.override.version)) continue;

          try {
            const saved = this.options.coverOverrides.save(
              track.id,
              downloaded.data,
              downloaded.contentType
            );
            if (!saved?.override) continue;
            externallyCovered.add(track.id);
            artworkChanged = true;
            if (this.job) this.job.externalFound += 1;
          } catch {
            // Se persistir a capa externa falhar, o fallback local será tentado abaixo.
          }
        }
      }

      if (this.job) this.job.phase = 'generating';
      for (const track of tracks) {
        if (signal.aborted) throw new Error('Preenchimento de capas interrompido.');
        if (externallyCovered.has(track.id)) continue;

        const status = this.options.coverOverrides.getStatus(track.id);
        if (!status || status.physicalHasCover) continue;
        if (status.override) {
          if (this.isGeneratedOverride(track, status.override.version) && this.job) {
            this.job.generated += 1;
          }
          continue;
        }

        try {
          const generated = this.renderArtwork(track);
          const saved = this.options.coverOverrides.save(
            track.id,
            generated.data,
            generated.contentType
          );
          if (!saved?.override) throw new Error('Falha ao persistir capa gerada.');
          artworkChanged = true;
          if (this.job) this.job.generated += 1;
        } catch {
          if (this.job) this.job.failed += 1;
        }
      }

      if (artworkChanged) this.options.onArtworkChanged();
      if (this.job) {
        this.job.status = 'completed';
        this.job.phase = 'completed';
        this.job.finishedAt = this.now().toISOString();
      }
    } catch (error) {
      if (artworkChanged) this.options.onArtworkChanged();
      if (this.job) {
        this.job.status = 'failed';
        this.job.phase = 'failed';
        this.job.finishedAt = this.now().toISOString();
        this.job.error = errorMessage(error);
      }
    } finally {
      this.controller = null;
      this.active = null;
    }
  }
}
