import assert from 'node:assert/strict';
import test from 'node:test';
import type { Track, AdminTrackCoverResponse } from '@home-music/shared';
import type { LibraryAssistantAnalyzer } from './library-assistant-service.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { renderGeneratedArtworkPng } from './generated-artwork.js';
import { MissingCoverFillService } from './missing-cover-fill-service.js';
import {
  inspectCoverOverride,
  type TrackCoverOverrideStore
} from './track-cover-overrides.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function track(id: string, hasCover = false, coverVersion?: string): Track {
  return {
    id,
    title: `Faixa ${id}`,
    artist: 'Artista',
    album: 'Mesmo álbum',
    albumArtist: 'Artista',
    folder: 'Pasta',
    folderPath: 'Pasta',
    duration: 180,
    format: 'MP3',
    hasCover,
    ...(coverVersion ? { coverVersion } : {})
  };
}

function fakeCoverStore(
  tracks: Track[],
  initialVersions: Record<string, string | null> = {}
) {
  const versions = new Map<string, string | null>(
    tracks.map(item => [item.id, initialVersions[item.id] ?? null])
  );
  const physical = new Map(tracks.map(item => [item.id, false]));
  let saves = 0;

  const response = (trackId: string): AdminTrackCoverResponse | null => {
    if (!versions.has(trackId)) return null;
    const version = versions.get(trackId) ?? null;
    return {
      trackId,
      physicalHasCover: physical.get(trackId) ?? false,
      effectiveHasCover: Boolean(version),
      override: version
        ? {
            contentType: 'image/png',
            width: 1,
            height: 1,
            sizeBytes: PNG_1X1.byteLength,
            updatedAt: '2026-09-20T00:00:00.000Z',
            version
          }
        : null
    };
  };

  const store = {
    refresh() {},
    getStatus: response,
    save(trackId: string, data: Buffer, contentType: string) {
      if (!versions.has(trackId)) return null;
      const inspected = inspectCoverOverride(data, contentType);
      versions.set(trackId, inspected.version);
      saves += 1;
      return response(trackId);
    }
  } satisfies Pick<TrackCoverOverrideStore, 'refresh' | 'getStatus' | 'save'>;

  return {
    store,
    versions,
    get saves() { return saves; }
  };
}

async function waitForCompletion(service: MissingCoverFillService) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = service.getJob();
    if (job && job.status !== 'running') return job;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Preenchimento de capas não terminou no prazo do teste.');
}

function artworkAnalyzer(sourceUrl: string): LibraryAssistantAnalyzer {
  return {
    id: 'artwork-test',
    capability: 'artwork',
    async analyze({ tracks }) {
      return tracks.map(item => ({
        capability: 'artwork' as const,
        confidence: 'high' as const,
        reasonCodes: ['artwork-missing' as const, 'strong-external-id' as const],
        evidence: [],
        provenance: {
          source: 'cover-art-archive' as const,
          providerVersion: 'test',
          externalId: 'release-1'
        },
        target: {
          capability: 'artwork' as const,
          trackId: item.id,
          candidateId: `cover:${item.id}`,
          label: 'Capa frontal',
          sourceUrl,
          thumbnailUrl: null,
          currentHasCover: false,
          currentCoverVersion: null,
          musicBrainzReleaseId: 'release-1',
          musicBrainzReleaseGroupId: 'release-group-1'
        }
      }));
    }
  };
}

test('baixa uma capa uma vez e reutiliza para faixas do mesmo lançamento', async () => {
  const plain = track('plain');
  const generatedSource = track('generated');
  const generated = renderGeneratedArtworkPng(generatedSource);
  const generatedVersion = inspectCoverOverride(generated.data, generated.contentType).version;
  const generatedTrack = track('generated', true, generatedVersion);
  const manualTrack = track('manual', true, 'manual-cover');
  const tracks = [plain, generatedTrack, manualTrack];
  const covers = fakeCoverStore(tracks, {
    generated: generatedVersion,
    manual: 'manual-cover'
  });
  let downloads = 0;
  let changed = 0;

  const service = new MissingCoverFillService({
    library: { listTracks: () => tracks },
    analyzer: artworkAnalyzer('https://coverartarchive.org/release/release-1/front'),
    providers: {} as LibraryAssistantProviderGateway,
    coverOverrides: covers.store,
    onArtworkChanged: () => { changed += 1; },
    downloadArtwork: async () => {
      downloads += 1;
      return {
        data: PNG_1X1,
        contentType: 'image/png',
        finalUrl: 'https://coverartarchive.org/release/release-1/front'
      };
    }
  });

  const started = service.start();
  assert.equal(started?.total, 2);

  const job = await waitForCompletion(service);
  assert.equal(job.status, 'completed');
  assert.equal(job.externalFound, 2);
  assert.equal(job.generated, 0);
  assert.equal(job.failed, 0);
  assert.equal(downloads, 1);
  assert.equal(covers.saves, 2);
  assert.equal(changed, 1);
  assert.equal(covers.versions.get('manual'), 'manual-cover');
  assert.notEqual(covers.versions.get('generated'), generatedVersion);
});

test('gera fallback local quando nenhuma capa externa confiável é encontrada', async () => {
  const missing = track('missing');
  const covers = fakeCoverStore([missing]);
  let changed = 0;

  const analyzer: LibraryAssistantAnalyzer = {
    id: 'artwork-empty',
    capability: 'artwork',
    async analyze() {
      return [];
    }
  };

  const service = new MissingCoverFillService({
    library: { listTracks: () => [missing] },
    analyzer,
    providers: {} as LibraryAssistantProviderGateway,
    coverOverrides: covers.store,
    onArtworkChanged: () => { changed += 1; }
  });

  service.start();
  const job = await waitForCompletion(service);

  assert.equal(job.status, 'completed');
  assert.equal(job.externalFound, 0);
  assert.equal(job.generated, 1);
  assert.equal(job.failed, 0);
  assert.equal(covers.saves, 1);
  assert.equal(changed, 1);
  assert.ok(covers.versions.get('missing'));
});
