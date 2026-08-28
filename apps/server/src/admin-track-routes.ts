import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AdminQuarantineResponse,
  AdminTrack,
  AdminTracksResponse,
  Track
} from '@home-music/shared';
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

export function registerAdminTrackRoutes(
  app: FastifyInstance,
  service: AdminTrackService,
  options: AdminTrackRouteOptions = {}
) {
  const databasePath = options.databasePath || process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
  const quarantine = new MediaQuarantineStore(
    databasePath,
    options.musicDir ?? process.env.MUSIC_DIR ?? ''
  );
  const metadataOverrides = new TrackMetadataOverrideStore(databasePath);
  const coverOverrides = new TrackCoverOverrideStore(databasePath);
  let metadataRevision = 0;
  let coverRevision = 0;
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
    coverOverrides.close();
    metadataOverrides.close();
    quarantine.close();
  });

  // Rejeita o caso normal de upload excessivo antes de ler o corpo. O bodyLimit do
  // parser continua protegendo transferências sem Content-Length.
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'PUT' || !adminCoverTrackId(request.url)) return;
    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_OVERRIDE_BYTES) {
      return reply.code(413).send({ error: 'A capa deve ter no máximo 8 MiB.' });
    }
  });

  // Overrides de capa são servidos antes da capa embutida. O conjunto de IDs públicos
  // evita varrer/alocar a biblioteca inteira em cada requisição de artwork.
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

  // O scanner e `tracks` mantêm somente metadata/capa físicas. Esta borda resolve a visão
  // efetiva sem promover overrides para o estado físico. A revisão composta permite
  // que outras abas percebam mudanças administrativas via polling normal da biblioteca.
  app.addHook('preSerialization', async (request, _reply, payload) => {
    const pathname = request.url.split('?', 1)[0];
    if (pathname !== '/api/library' && pathname !== '/api/library/status') return payload;

    let nextPayload = payload;
    if (pathname === '/api/library' && isTrackArrayPayload(nextPayload)) {
      metadataOverrides.refresh();
      coverOverrides.refresh();
      publicTrackIds = new Set(nextPayload.tracks.map(track => track.id));
      publicTrackIdsInitialized = true;
      nextPayload = {
        ...nextPayload,
        tracks: nextPayload.tracks.map(track =>
          coverOverrides.resolveTrack(metadataOverrides.resolveTrack(track))
        )
      };
    }
    if (isObjectPayload(nextPayload)) {
      return withAdminRevision(nextPayload, metadataRevision + coverRevision);
    }
    return nextPayload;
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
