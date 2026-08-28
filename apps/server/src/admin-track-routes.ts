import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  AdminQuarantineResponse,
  AdminTrack,
  AdminTrackMetadataResponse,
  AdminTracksResponse,
  TrackMetadataOverridePatch
} from '@home-music/shared';
import { MediaQuarantineOperationError, MediaQuarantineStore } from './media-quarantine.js';
import { UnsafeLibraryPathError } from './security.js';
import { normalizeMetadataOverridePatch } from './track-metadata-overrides.js';

export const PERMANENT_DELETE_CONFIRMATION = 'EXCLUIR PERMANENTEMENTE' as const;

const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));

type AdminTrackService = {
  listTracks: () => AdminTrack[];
  setEnabled: (trackId: string, enabled: boolean) => AdminTrack | null;
  getMetadata: (trackId: string) => AdminTrackMetadataResponse | null;
  patchMetadata: (trackId: string, patch: TrackMetadataOverridePatch) => AdminTrackMetadataResponse | null;
  clearMetadata: (trackId: string) => AdminTrackMetadataResponse | null;
};

type AdminTrackRouteOptions = {
  databasePath?: string;
  musicDir?: string;
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

export function registerAdminTrackRoutes(
  app: FastifyInstance,
  service: AdminTrackService,
  options: AdminTrackRouteOptions = {}
) {
  const quarantine = new MediaQuarantineStore(
    options.databasePath || process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath,
    options.musicDir ?? process.env.MUSIC_DIR ?? ''
  );

  app.addHook('onClose', async () => { quarantine.close(); });

  app.get('/api/admin/tracks', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    quarantine.pruneResolvedTombstones();
    const tracks = service.listTracks().filter(track => !quarantine.hasHidden(track.id));
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
      return { track };
    }
  );

  app.get<{ Params: { id: string } }>('/api/admin/tracks/:id/metadata', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar os metadados.' });
    }
    const metadata = service.getMetadata(request.params.id);
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

      let patch: TrackMetadataOverridePatch;
      try {
        patch = normalizeMetadataOverridePatch(request.body);
      } catch (error) {
        return sendMetadataValidationError(reply, error);
      }

      const metadata = service.patchMetadata(request.params.id, patch);
      if (!metadata) return reply.code(404).send({ error: 'Música não encontrada.' });
      return metadata;
    }
  );

  app.delete<{ Params: { id: string } }>('/api/admin/tracks/:id/metadata', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (quarantine.hasHidden(request.params.id)) {
      return reply.code(409).send({ error: 'Música está na lixeira. Restaure antes de editar os metadados.' });
    }
    const metadata = service.clearMetadata(request.params.id);
    if (!metadata) return reply.code(404).send({ error: 'Música não encontrada.' });
    return metadata;
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

    const track = service.listTracks().find(item => item.id === request.params.id);
    if (!track) return reply.code(404).send({ error: 'Música não encontrada.' });
    const { enabled: previousEnabled, ...publicTrack } = track;

    if (previousEnabled) service.setEnabled(track.id, false);
    try {
      const quarantined = await quarantine.quarantine(track.id, publicTrack, previousEnabled);
      return { track: quarantined };
    } catch (error) {
      if (previousEnabled && !quarantine.hasHidden(track.id)) service.setEnabled(track.id, true);
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
        },
        () => { service.setEnabled(request.params.id, false); }
      );
      return { track };
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
        return reply.code(204).send();
      } catch (error) {
        return sendQuarantineError(reply, error);
      }
    }
  );
}
