import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AdminTrackCoverCandidate,
  AdminTrackCoverCandidatesResponse,
  AdminTrackMetadataSuggestionResponse,
  EditableTrackMetadata,
  Track
} from '@home-music/shared';
import {
  downloadTrustedArtworkImage,
  type DownloadedCoverArtArchiveImage
} from './cover-art-archive.js';
import type { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import {
  findMusicBrainzArtworkCandidates,
  findTrackMetadataSuggestion
} from './musicbrainz-metadata-analyzer.js';
import {
  CoverOverrideValidationError,
  inspectCoverOverride,
  type TrackCoverOverrideStore
} from './track-cover-overrides.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ArtworkSearchRoutesOptions = {
  providers: LibraryAssistantProviderGateway;
  coverOverrides: TrackCoverOverrideStore;
  listTracks: () => Track[];
  resolveTrackFile?: (trackId: string) => string | null;
  fetchImpl?: FetchLike;
  onArtworkChanged: () => void;
};

type SearchBody = Partial<EditableTrackMetadata>;

type ApplyBody = Pick<
  AdminTrackCoverCandidate,
  'sourceUrl' | 'thumbnailUrl'
>;

const METADATA_FIELDS = ['title', 'artist', 'album', 'albumArtist'] as const;

function safeMetadataValue(value: unknown) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().replace(/\s+/g, ' ');
  return clean && clean.length <= 240 ? clean : null;
}

function searchTrack(track: Track, body: SearchBody | undefined) {
  if (!body) return track;
  const patch: Partial<EditableTrackMetadata> = {};
  for (const field of METADATA_FIELDS) {
    if (body[field] == null) continue;
    const value = safeMetadataValue(body[field]);
    if (!value) return null;
    patch[field] = value;
  }
  return { ...track, ...patch };
}

function candidateUrls(body: ApplyBody | undefined) {
  if (!body || typeof body.sourceUrl !== 'string') return null;
  const sourceUrl = body.sourceUrl.trim();
  const thumbnailUrl = typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl.trim() : null;
  if (!sourceUrl || sourceUrl.length > 2_048 || (thumbnailUrl && thumbnailUrl.length > 2_048)) return null;
  return thumbnailUrl && thumbnailUrl !== sourceUrl
    ? [thumbnailUrl, sourceUrl]
    : [sourceUrl];
}

async function downloadValidatedArtwork(
  urls: readonly string[],
  fetchImpl?: FetchLike
): Promise<DownloadedCoverArtArchiveImage> {
  let lastError: unknown = null;
  for (const url of urls) {
    try {
      const downloaded = await downloadTrustedArtworkImage(url, { fetchImpl });
      const inspected = inspectCoverOverride(downloaded.data, downloaded.contentType);
      return { ...downloaded, contentType: inspected.contentType };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Não foi possível carregar uma capa válida.');
}

function sendArtworkError(reply: FastifyReply, error: unknown) {
  if (error instanceof CoverOverrideValidationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  const message = error instanceof Error ? error.message : 'Não foi possível carregar a capa.';
  return reply.code(502).send({ error: message });
}

export function registerTrackArtworkSearchRoutes(
  app: FastifyInstance,
  options: ArtworkSearchRoutesOptions
) {
  app.post<{ Params: { id: string }; Body: SearchBody }>(
    '/api/admin/library-assistant/tracks/:id/metadata-suggestion',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const track = options.listTracks().find(item => item.id === request.params.id);
      if (!track) return reply.code(404).send({ error: 'Música não encontrada.' });

      const effectiveTrack = searchTrack(track, request.body);
      if (!effectiveTrack) return reply.code(400).send({ error: 'Metadados para busca inválidos.' });

      try {
        const suggestion = await findTrackMetadataSuggestion(
          effectiveTrack,
          options.providers,
          {
            fetchImpl: options.fetchImpl,
            getFileContext(trackId) {
              const file = options.resolveTrackFile?.(trackId);
              return file
                ? { fileName: path.basename(file), folderName: effectiveTrack.folder || null }
                : null;
            }
          }
        );
        const response: AdminTrackMetadataSuggestionResponse = { suggestion };
        return response;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível buscar melhorias de metadados agora.';
        return reply.code(502).send({ error: message });
      }
    }
  );

  app.post<{ Params: { id: string }; Body: SearchBody }>(
    '/api/admin/library-assistant/tracks/:id/artwork-candidates',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const track = options.listTracks().find(item => item.id === request.params.id);
      if (!track) return reply.code(404).send({ error: 'Música não encontrada.' });

      const effectiveTrack = searchTrack(track, request.body);
      if (!effectiveTrack) return reply.code(400).send({ error: 'Metadados para busca de capa inválidos.' });

      try {
        const candidates = await findMusicBrainzArtworkCandidates(
          effectiveTrack,
          options.providers,
          {
            fetchImpl: options.fetchImpl,
            getFileContext(trackId) {
              const file = options.resolveTrackFile?.(trackId);
              return file
                ? { fileName: path.basename(file), folderName: effectiveTrack.folder || null }
                : null;
            }
          }
        );
        const response: AdminTrackCoverCandidatesResponse = { candidates };
        return response;
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível buscar capas agora.';
        return reply.code(502).send({ error: message });
      }
    }
  );

  app.get<{
    Querystring: { sourceUrl?: string; thumbnailUrl?: string };
  }>(
    '/api/admin/library-assistant/artwork-candidates/preview',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, max-age=300');
      const urls = candidateUrls({
        sourceUrl: request.query.sourceUrl ?? '',
        thumbnailUrl: request.query.thumbnailUrl ?? null
      });
      if (!urls) return reply.code(400).send({ error: 'Capa externa inválida.' });

      try {
        const downloaded = await downloadValidatedArtwork(urls, options.fetchImpl);
        reply.type(downloaded.contentType);
        reply.header('Content-Length', downloaded.data.byteLength);
        return reply.send(downloaded.data);
      } catch (error) {
        return sendArtworkError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: ApplyBody }>(
    '/api/admin/library-assistant/tracks/:id/artwork-candidates/apply',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const before = options.coverOverrides.getStatus(request.params.id);
      if (!before) return reply.code(404).send({ error: 'Música não encontrada.' });
      const urls = candidateUrls(request.body);
      if (!urls) return reply.code(400).send({ error: 'Capa externa inválida.' });

      try {
        const downloaded = await downloadValidatedArtwork(urls, options.fetchImpl);
        const saved = options.coverOverrides.save(
          request.params.id,
          downloaded.data,
          downloaded.contentType
        );
        if (!saved) return reply.code(404).send({ error: 'Música não encontrada.' });
        if (before.override?.version !== saved.override?.version) options.onArtworkChanged();
        return saved;
      } catch (error) {
        return sendArtworkError(reply, error);
      }
    }
  );
}
