import type { FastifyInstance, FastifyReply } from 'fastify';
import type { LibraryService } from './library-service.js';
import {
  M3u8InputError,
  exportM3u8,
  hashM3u8Content,
  previewM3u8,
  trackIdsFromPreview
} from './m3u8-playlists.js';
import type { PersonalLibraryService } from './personal-library-service.js';

type M3u8PersonalLibrary = Pick<
  PersonalLibraryService,
  'getPlaylists' | 'createPlaylist' | 'setPlaylistTracks' | 'deletePlaylist'
>;

type M3u8Library = Pick<LibraryService, 'root' | 'allTracks'>;

type PreviewBody = {
  content?: unknown;
};

type ImportBody = {
  content?: unknown;
  name?: unknown;
  previewHash?: unknown;
  confirmed?: unknown;
};

export function registerM3u8PlaylistRoutes(
  app: FastifyInstance,
  personal: M3u8PersonalLibrary,
  library: M3u8Library
) {
  app.post<{ Body: PreviewBody }>('/api/playlists/m3u8/preview', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Importação de playlist exige uma identidade persistida.'
      });
    }

    try {
      reply.header('Cache-Control', 'private, no-store');
      return previewM3u8(request.body?.content, library);
    } catch (error) {
      return sendInputError(reply, error);
    }
  });

  app.post<{ Body: ImportBody }>('/api/playlists/m3u8/import', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Importação de playlist exige uma identidade persistida.'
      });
    }
    if (request.body?.confirmed !== true) {
      return reply.code(409).send({
        error: 'Confirme explicitamente o preview antes de criar a playlist.'
      });
    }
    if (typeof request.body?.content !== 'string' || typeof request.body?.previewHash !== 'string') {
      return reply.code(400).send({ error: 'Conteúdo ou hash de preview inválido.' });
    }
    if (hashM3u8Content(request.body.content) !== request.body.previewHash) {
      return reply.code(409).send({
        error: 'O conteúdo mudou depois do preview. Gere um novo preview antes de importar.'
      });
    }

    let preview;
    try {
      preview = previewM3u8(request.body.content, library);
    } catch (error) {
      return sendInputError(reply, error);
    }

    const trackIds = trackIdsFromPreview(preview);
    if (trackIds.length === 0) {
      return reply.code(422).send({
        error: 'Nenhuma faixa do arquivo pôde ser resolvida na biblioteca atual.',
        preview
      });
    }

    const created = personal.createPlaylist(request.user.id, request.body?.name);
    if (created.status === 'invalid-name' || !created.playlist) {
      return reply.code(400).send({ error: 'Nome da playlist obrigatório.' });
    }

    const updated = personal.setPlaylistTracks(request.user.id, created.playlist.id, trackIds);
    if (updated.status !== 'ok') {
      personal.deletePlaylist(request.user.id, created.playlist.id);
      return reply.code(409).send({
        error: 'A playlist não pôde ser preenchida com as faixas resolvidas.'
      });
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(201).send({
      playlist: {
        ...created.playlist,
        trackIds: updated.trackIds ?? []
      },
      preview,
      imported: updated.trackIds?.length ?? 0
    });
  });

  app.get<{ Params: { id: string } }>('/api/playlists/:id/m3u8', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({
        error: 'Exportação de playlist exige uma identidade persistida.'
      });
    }

    const playlist = personal.getPlaylists(request.user.id)
      .find(item => item.id === request.params.id);
    if (!playlist) {
      return reply.code(404).send({ error: 'Playlist não encontrada.' });
    }
    if (playlist.source !== 'manual') {
      return reply.code(409).send({
        error: 'Somente playlists manuais podem ser exportadas em M3U8.'
      });
    }

    const exported = exportM3u8(playlist.trackIds, library);
    if (exported.omittedTrackIds.length > 0) {
      return reply.code(409).send({
        error: 'A playlist contém faixas sem caminho portátil na biblioteca atual.',
        omitted: exported.omittedTrackIds.length
      });
    }

    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="playlist.m3u8"');
    return exported.content;
  });
}

function sendInputError(reply: FastifyReply, error: unknown) {
  if (error instanceof M3u8InputError) {
    return reply.code(error.statusCode).send({ error: error.message, code: error.code });
  }
  throw error;
}
