import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AdminLibraryDuplicateIgnoreRequest,
  AdminQuarantineResponse,
  AdminTrack,
  AdminTrackMoveRequest,
  AdminTrackMoveResponse,
  AdminTracksResponse,
  Track
} from '@home-music/shared';
import { registerAdminLibraryNormalizationRoutes } from './admin-library-normalization-routes.js';
import { LibraryDuplicateReviewError, LibraryDuplicateReviewStore } from './library-duplicate-review.js';
import { LibraryMetadataNormalizationStore } from './library-metadata-normalization.js';
import {
  type AppliedTrackLocation,
  MediaFileMoveOperationError,
  MediaFileMoveStore
} from './media-file-move.js';
import { MediaQuarantineOperationError, MediaQuarantineStore } from './media-quarantine.js';
import { UnsafeLibraryPathError } from './security.js';
import {
  COVER_OVERRIDE_CONTENT_TYPES,
  CoverOverrideValidationError,
  MAX_COVER_OVERRIDE_BYTES,
  TrackCoverOverrideStore
} from './track-cover-overrides.js';
import {
  normalizeMetadataOverridePatch,
  TrackMetadataOverrideStore
} from './track-metadata-overrides.js';

export const PERMANENT_DELETE_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE' as const;

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const COVER_UPLOAD_BODY_LIMIT = MAX_COVER_OVERRIDE_BYTES + 1024;

type AdminTrackService = {
  listTracks: () => AdminTrack[];
  setEnabled: (trackId: string, enabled: boolean) => AdminTrack | null;
  setLocation: (trackId: string, location: AppliedTrackLocation) => AdminTrack | null;
};

type AdminTrackRouteOptions = {
  databasePath?: string;
  musicDir?: string;
};

type RevisionPayload = {
  revision?: unknown;
};

function sendQuarantineError(reply: FastifyReply, error: unknown) {
  if (error instanceof MediaQuarantineOperationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof UnsafeLibraryPathError) {
    return reply.code(409).send({ error: 'A operação foi bloqueada por segurança de caminho.' });
  }
  throw error;
}

function sendDuplicateReviewError(reply: FastifyReply, error: unknown) {
  if (error instanceof LibraryDuplicateReviewError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  throw error;
}

function sendFileMoveError(reply: FastifyReply, error: unknown) {
  if (error instanceof MediaFileMoveOperationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  if (error instanceof UnsafeLibraryPathError) {
    return reply.code(409).send({ error: 'A movimentação foi bloqueada por segurança de caminho.' });
  }
  throw error;
}

function sendMetadataValidationError(reply: FastifyReply, error: unknown) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return reply.code(400).send({ error: error.message });
  }
  throw error;
}

function sendCoverValidationError(reply: FastifyReply, error: unknown) {
  if (error instanceof CoverOverrideValidationError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  throw error;
}

function isObjectPayload(payload: unknown): payload is Record<string, unknown> {
  return Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload);
}

function isTrackArrayPayload(payload: unknown): payload is { tracks: Track[] } {
  if (!isObjectPayload(payload)) return false;
  return Array.isArray(payload.tracks);
}

function withAdminRevision<T extends Record<string, unknown>>(payload: T, adminRevision: number): T {
  const revision = (payload as RevisionPayload).revision;
  if (!Number.isInteger(revision)) return payload;
  return { ...payload, revision: Number(revision) + adminRevision };
}

function routeTrackId(url: string, pattern: RegExp) {
  const pathname = url.split('?', 1)[0];
  const match = pattern.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function publicCoverTrackId(url: string) {
  return routeTrackId(url, /^\/api\/tracks\/([^/]+)\/cover$/);
}

function adminCoverTrackId(url: string) {
  return routeTrackId(url, /^\/api\/admin\/tracks\/([^/]+)\/cover$/);
}

function duplicateTrackIds(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const ids = value.map(item => typeof item === 'string' ? item.trim() : '');
  if (ids.some(id => !id || id.length > 64) || ids[0] === ids[1]) return null;
  return [ids[0], ids[1]];
}

export function registerAdminTrackRoutes(
  app: FastifyInstance,
  service: AdminTrackService,
  options: AdminTrackRouteOptions = {}
) {
  const databasePath = options.databasePath || process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
  const musicDir = options.musicDir ?? process.env.MUSIC_DIR ?? '';
  const quarantine = new MediaQuarantineStore(databasePath, musicDir);
  const duplicateReview = new LibraryDuplicateReviewStore({
    databasePath,
    musicDir,
    isHidden: trackId => quarantine.hasHidden(trackId)
  });
  const fileMoves = new MediaFileMoveStore(databasePath, musicDir);
  const metadataOverrides = new TrackMetadataOverrideStore(databasePath);
  const metadataNormalization = new LibraryMetadataNormalizationStore(databasePath);
  const coverOverrides = new TrackCoverOverrideStore(databasePath);
  let metadataRevision = 0;
  let normalizationRevision = 0;
  let coverRevision = 0;
  let fileRevision = 0;
  let publicTrackIds = new Set<string>();
  let publicTrackIdsInitialized = false;

  function syncPublicTrackIds(tracks: Array<Pick<AdminTrack, 'id' | 'enabled'>>) {
    publicTrackIds = new Set(tracks.filter(track => track.enabled).map(track => track.id));
    publicTrackIdsInitialized = true;
  }

  function ensurePublicTrackIds() {
    if (!publicTrackIdsInitialized) syncPublicTrackIds(service.listTracks());
  }

  for (const contentType of COVER_OVERRIDE_CONTENT_TYPES) {
    if (app.hasContentTypeParser(contentType)) continue;
    app.addContentTypeParser(
      contentType,
      { parseAs: 'buffer', bodyLimit: COVER_UPLOAD_BODY_LIMIT },
      (_request, body, done) => { done(null, body); }
    );
  }

  app.addHook('onClose', async () => {
    fileMoves.close();
    coverOverrides.close();
    metadataNormalization.close();
    metadataOverrides.close();
    duplicateReview.close();
    quarantine.close();
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'PUT' || !adminCoverTrackId(request.url)) return;
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_OVERRIDE_BYTES) {
      return reply.code(413).send({ error: 'A capa deve ter no máximo 8 MiB.' });
    }
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'GET') return;
    const trackId = publicCoverTrackId(request.url);
    if (!trackId) return;
    ensurePublicTrackIds();
    if (!publicTrackIds.has(trackId)) return;

    const override = coverOverrides.read(trackId);
    if (!override) return;
    const etag = `"cover-${override.version}"`;
    if (request.headers['if-none-match'] === etag) {
      reply.header('ETag', etag);
      reply.header('Cache-Control', 'private, max-age=86400, immutable');
      return reply.code(304).send();
    }

    reply.type(override.contentType);
    reply.header('Content-Length', override.data.byteLength);
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'private, max-age=86400, immutable');
    return reply.send(override.data);
  });

  // Scanner mantém somente os valores físicos. Overrides por faixa e aliases globais
  // compõem a visão pública sem trocar a identidade estável da faixa.
  app.addHook('preSerialization', async (request, _reply, payload) => {
    const pathname = request.url.split('?', 1)[0];
    if (pathname !== '/api/library' && pathname !== '/api/library/status') return payload;

    let nextPayload = payload;
    if (pathname === '/api/library' && isTrackArrayPayload(nextPayload)) {
      metadataOverrides.refresh();
      metadataNormalization.refresh();
      coverOverrides.refresh();
      publicTrackIds = new Set(nextPayload.tracks.map(track => track.id));
      publicTrackIdsInitialized = true;
      nextPayload = {
        ...nextPayload,
        tracks: nextPayload.tracks.map(track =>
          coverOverrides.resolveTrack(
            metadataNormalization.resolveTrack(metadataOverrides.resolveTrack(track))
          )
        )
      };
    }
    if (isObjectPayload(nextPayload)) {
      return withAdminRevision(
        nextPayload,
        metadataRevision + normalizationRevision + coverRevision + fileRevision
      );
    }
    return nextPayload;
  });

  registerAdminLibraryNormalizationRoutes(app, metadataNormalization, {
    onChanged: () => { normalizationRevision += 1; }
  });

  app.get('/api/admin/tracks', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    quarantine.pruneResolvedTombstones();
    metadataOverrides.refresh();
    coverOverrides.refresh();
    const physicalTracks = service.listTracks();
    syncPublicTrackIds(physicalTracks);
    const tracks = physicalTracks
      .filter(track => !quarantine.hasHidden(track.id))
      .map(track => coverOverrides.resolveTrack(metadataOverrides.resolveTrack(track)));
    const response: AdminTracksResponse = {
      tracks,
      active: tracks.filter(track => track.enabled).length,
      inactive: tracks.filter(track => !track.enabled).length
    };
    return response;
  });

  app.post('/api/admin/library/duplicates/check', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    quarantine.pruneResolvedTombstones();
    try {
      return await duplicateReview.check();
    } catch (error) {
      return sendDuplicateReviewError(reply, error);
    }
  });

  app.post<{ Body: AdminLibraryDuplicateIgnoreRequest }>(
    '/api/admin/library/duplicates/ignore',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const trackIds = duplicateTrackIds(request.body?.trackIds);
      if (!trackIds || typeof request.body?.ignored !== 'boolean') {
        return reply.code(400).send({ error: 'Revisão de duplicata inválida.' });
      }
      try {
        return duplicateReview.setIgnored(trackIds, request.body.ignored);
      } catch (error) {
        return sendDuplicateReviewError(reply, error);
      }
    }
  );

  app.patch<{ Params: { id: string }; Body: { enabled?: unknown } }>(
    '/api/admin/tracks/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (typeof request.body?.enabled !== 'boolean') {
        return reply.code(400).send({ error: 'Estado da música inválido.' });
      }
      if (quarantine.hasHidden(request.params.id)) {
        return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de alterar a disponibilidade.' });
      }

      const track = service.setEnabled(request.params.id, request.body.enabled);
      if (!track) return reply.code(404).send({ error: 'Música não encontrada.' });
      publicTrackIdsInitialized = true;
      if (track.enabled) publicTrackIds.add(track.id); else publicTrackIds.delete(track.id);
      metadataOverrides.refresh();
      coverOverrides.refresh();
      return { track: coverOverrides.resolveTrack(metadataOverrides.resolveTrack(track)) };
    }
  );

  app.get<{ Params: { id: string } }>('/api/admin/tracks/:id/location', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de mover o arquivo.' });
    }
    try {
      const location = await fileMoves.getLocation(request.params.id);
      if (!location) return reply.code(404).send({ error: 'Música não encontrada.' });
      return location;
    } catch (error) {
      return sendFileMoveError(reply, error);
    }
  });

  app.post<{ Params: { id: string }; Body: AdminTrackMoveRequest }>(
    '/api/admin/tracks/:id/move',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (quarantine.hasHidden(request.params.id)) {
        return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de mover o arquivo.' });
      }

      try {
        const result = await fileMoves.move(
          request.params.id,
          request.body ?? ({} as AdminTrackMoveRequest),
          location => service.setLocation(request.params.id, location)
        );
        if (result.moved) fileRevision += 1;
        metadataOverrides.refresh();
        coverOverrides.refresh();
        const response: AdminTrackMoveResponse = {
          ...result,
          track: coverOverrides.resolveTrack(metadataOverrides.resolveTrack(result.track))
        };
        return response;
      } catch (error) {
        return sendFileMoveError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>('/api/admin/tracks/:id/metadata', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar os metadados.' });
    }
    const metadata = metadataOverrides.get(request.params.id);
    if (!metadata) return reply.code(404).send({ error: 'Música não encontrada.' });
    return metadata;
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    '/api/admin/tracks/:id/metadata',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (quarantine.hasHidden(request.params.id)) {
        return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar os metadados.' });
      }

      try {
        const patch = normalizeMetadataOverridePatch(request.body);
        const metadata = metadataOverrides.patch(request.params.id, patch);
        if (!metadata) return reply.code(404).send({ error: 'Música não encontrada.' });
        metadataRevision += 1;
        return metadata;
      } catch (error) {
        return sendMetadataValidationError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>('/api/admin/tracks/:id/metadata', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar os metadados.' });
    }
    const metadata = metadataOverrides.clear(request.params.id);
    if (!metadata) return reply.code(404).send({ error: 'Música não encontrada.' });
    metadataRevision += 1;
    return metadata;
  });

  app.get<{ Params: { id: string } }>('/api/admin/tracks/:id/cover', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar a capa.' });
    }
    const cover = coverOverrides.getStatus(request.params.id);
    if (!cover) return reply.code(404).send({ error: 'Música não encontrada.' });
    return cover;
  });

  app.put<{ Params: { id: string }; Body: Buffer }>(
    '/api/admin/tracks/:id/cover',
    { bodyLimit: COVER_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (quarantine.hasHidden(request.params.id)) {
        return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar a capa.' });
      }
      const before = coverOverrides.getStatus(request.params.id);
      if (!before) return reply.code(404).send({ error: 'Música não encontrada.' });

      try {
        const contentType = typeof request.headers['content-type'] === 'string'
          ? request.headers['content-type']
          : '';
        const cover = coverOverrides.save(request.params.id, request.body, contentType);
        if (!cover) return reply.code(404).send({ error: 'Música não encontrada.' });
        if (before.override?.version !== cover.override?.version) coverRevision += 1;
        return cover;
      } catch (error) {
        return sendCoverValidationError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>('/api/admin/tracks/:id/cover', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar a capa.' });
    }
    const before = coverOverrides.getStatus(request.params.id);
    if (!before) return reply.code(404).send({ error: 'Música não encontrada.' });
    const cover = coverOverrides.clear(request.params.id);
    if (!cover) return reply.code(404).send({ error: 'Música não encontrada.' });
    if (before.override) coverRevision += 1;
    return cover;
  });

  app.get('/api/admin/quarantine', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    quarantine.pruneResolvedTombstones();
    const response: AdminQuarantineResponse = { tracks: quarantine.listItems() };
    return response;
  });

  app.post<{ Params: { id: string } }>('/api/admin/tracks/:id/quarantine', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música já está na lixeira.' });
    }

    const physicalTrack = service.listTracks().find(item => item.id === request.params.id);
    if (!physicalTrack) return reply.code(404).send({ error: 'Música não encontrada.' });
    metadataOverrides.refresh();
    coverOverrides.refresh();
    const track = coverOverrides.resolveTrack(metadataOverrides.resolveTrack(physicalTrack));
    const { enabled: previousEnabled, ...publicTrack } = track;

    if (previousEnabled) {
      service.setEnabled(track.id, false);
      publicTrackIds.delete(track.id);
      publicTrackIdsInitialized = true;
    }
    try {
      const quarantined = await quarantine.quarantine(track.id, publicTrack, previousEnabled);
      return { track: quarantined };
    } catch (error) {
      if (previousEnabled && !quarantine.hasHidden(track.id)) {
        service.setEnabled(track.id, true);
        publicTrackIds.add(track.id);
      }
      return sendQuarantineError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>('/api/admin/quarantine/:id/restore', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      const track = await quarantine.restore(
        request.params.id,
        enabled => {
          const restored = service.setEnabled(request.params.id, enabled);
          if (!restored) {
            throw new MediaQuarantineOperationError(409, 'Registro da música não está mais disponível para restauração.');
          }
          publicTrackIdsInitialized = true;
          if (restored.enabled) publicTrackIds.add(restored.id); else publicTrackIds.delete(restored.id);
        },
        () => {
          service.setEnabled(request.params.id, false);
          publicTrackIds.delete(request.params.id);
          publicTrackIdsInitialized = true;
        }
      );
      metadataOverrides.refresh();
      coverOverrides.refresh();
      return { track: coverOverrides.resolveTrack(metadataOverrides.resolveTrack(track)) };
    } catch (error) {
      return sendQuarantineError(reply, error);
    }
  });

  app.delete<{ Params: { id: string }; Body: { confirmation?: unknown } }>(
    '/api/admin/quarantine/:id',
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      if (request.body?.confirmation !== PERMANENT_DELETE_CONFIRMATION) {
        return reply.code(400).send({ error: 'Confirmação explícita de exclusão permanente obrigatória.' });
      }
      try {
        await quarantine.deletePermanently(request.params.id);
        publicTrackIds.delete(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return sendQuarantineError(reply, error);
      }
    }
  );
}