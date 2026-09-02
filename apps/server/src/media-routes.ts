import type { FastifyInstance } from 'fastify';
import type { NormalizationMode } from '@home-music/shared';
import type { LibraryService } from './library-service.js';
import { parseByteRange } from './security.js';
import type { TrackMediaInfrastructure } from './track-media-infrastructure.js';
import {
  parseTranscodeQuality,
  TranscodeExecutionError
} from './transcoding.js';

export function registerMediaRoutes(
  app: FastifyInstance,
  library: LibraryService,
  media: TrackMediaInfrastructure
) {
  app.get<{ Params: { id: string } }>('/api/tracks/:id/lyrics', async (request, reply) => {
    if (!library.getTrack(request.params.id) || !library.root) {
      return reply.code(404).send({ error: 'Música não encontrada.' });
    }

    const lyrics = await media.lyrics(request.params.id);
    reply.header('Cache-Control', 'no-store');
    return reply.send(lyrics);
  });

  app.get<{ Params: { id: string } }>('/api/tracks/:id/cover', async (request, reply) => {
    const cover = await media.cover(request.params.id);
    if (!cover) return reply.code(404).send();

    reply.type(cover.format);
    reply.header('Cache-Control', 'private, max-age=86400');
    return cover.data;
  });

  app.get<{ Params: { id: string } }>('/api/tracks/:id/stream', async (request, reply) => {
    const source = await media.openTrack(request.params.id);
    if (!source) return reply.code(404).send({ error: 'Música não encontrada.' });

    const { track, opened } = source;
    const range = parseByteRange(request.headers.range, opened.stat.size);

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', track.mimeType);
    reply.header('Cache-Control', 'private, no-store');

    if (range === null) {
      await opened.handle.close();
      reply.header('Content-Range', `bytes */${opened.stat.size}`);
      return reply.code(416).send();
    }

    if (range === undefined) {
      reply.header('Content-Length', opened.stat.size);
      return reply.send(opened.handle.createReadStream({ autoClose: true }));
    }

    reply.code(206);
    reply.header('Content-Range', `bytes ${range.start}-${range.end}/${opened.stat.size}`);
    reply.header('Content-Length', range.end - range.start + 1);
    return reply.send(opened.handle.createReadStream({
      start: range.start,
      end: range.end,
      autoClose: true
    }));
  });

  app.get<{
    Params: { id: string };
    Querystring: { quality?: string; normalization?: string };
  }>('/api/tracks/:id/transcode', async (request, reply) => {
    if (!library.getTrack(request.params.id) || !library.root) {
      return reply.code(404).send({ error: 'Música não encontrada.' });
    }

    const quality = parseTranscodeQuality(request.query.quality);
    if (!quality) return reply.code(400).send({ error: 'Qualidade de transcoding inválida.' });
    const normalization = parseNormalizationMode(request.query.normalization);
    if (!normalization) return reply.code(400).send({ error: 'Modo de normalização inválido.' });
    if (!media.ffmpegAvailable) {
      return reply.code(503).send({
        error: 'Transcoding indisponível porque FFmpeg não está disponível.'
      });
    }

    try {
      const preparedMedia = await media.prepareTranscode(
        request.params.id,
        quality,
        normalization
      );
      if (!preparedMedia) {
        return reply.code(404).send({ error: 'Música não encontrada.' });
      }

      const { track, prepared, transcoded, gainDb } = preparedMedia;
      const info = await transcoded.stat();
      if (!info.isFile() || info.size <= 0) {
        await transcoded.close();
        return reply.code(503).send({
          error: 'Áudio transcodificado não está disponível.'
        });
      }

      const range = parseByteRange(request.headers.range, info.size);
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Type', 'audio/mp4');
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Home-Music-Transcode-Quality', quality);
      reply.header('X-Home-Music-Transcode-Cache', prepared.cacheHit ? 'hit' : 'miss');
      reply.header(
        'X-Home-Music-Normalization',
        normalization === 'off' ? 'off' : gainDb == null ? 'unavailable' : normalization
      );

      if (range === null) {
        await transcoded.close();
        reply.header('Content-Range', `bytes */${info.size}`);
        return reply.code(416).send();
      }

      if (range === undefined) {
        reply.header('Content-Length', info.size);
        return reply.send(transcoded.createReadStream({ autoClose: true }));
      }

      reply.code(206);
      reply.header('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
      reply.header('Content-Length', range.end - range.start + 1);
      return reply.send(transcoded.createReadStream({
        start: range.start,
        end: range.end,
        autoClose: true
      }));
    } catch (error) {
      if (error instanceof TranscodeExecutionError) {
        if (error.reason === 'aborted' && (request.raw.aborted || reply.raw.destroyed)) return;

        const track = library.getTrack(request.params.id);
        app.log.warn(
          {
            err: error,
            trackId: track?.id ?? request.params.id,
            quality,
            normalization,
            reason: error.reason
          },
          'Falha ao preparar áudio transcodificado.'
        );
        return reply.code(503).send({
          error: 'Não foi possível preparar esta música na qualidade solicitada.'
        });
      }
      throw error;
    }
  });
}

function parseNormalizationMode(value: unknown): NormalizationMode | null {
  if (value == null || value === '' || value === 'off') return 'off';
  return value === 'track' || value === 'album' ? value : null;
}
