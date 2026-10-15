import type { FileHandle } from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseByteRange } from './security.js';
import type { TrackMediaInfrastructure } from './track-media-infrastructure.js';
import type { TranscodeQuality } from './transcoding.js';
import { boundedInteger, cleanText, failure, one, type Query } from './open-subsonic-http.js';

export type OpenSubsonicMedia = Pick<
  TrackMediaInfrastructure,
  'openTrack' | 'cover' | 'lyrics' | 'prepareTranscode' | 'ffmpegAvailable'
>;

export function transcodeQuality(maxBitRate: number): TranscodeQuality {
  if (maxBitRate <= 96) return 'economy';
  if (maxBitRate <= 160) return 'balanced';
  return 'high';
}

export async function sendOriginalRange(
  reply: FastifyReply,
  opened: { handle: FileHandle; stat: { size: number } },
  contentType: string,
  rangeHeader: string | undefined
) {
  const range = parseByteRange(rangeHeader, opened.stat.size);
  reply.header('Accept-Ranges', 'bytes');
  reply.header('Content-Type', contentType);
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
  return reply.send(opened.handle.createReadStream({ start: range.start, end: range.end, autoClose: true }));
}

export async function handleStream(
  request: FastifyRequest<{ Querystring: Query }>,
  reply: FastifyReply,
  options: { media: OpenSubsonicMedia }
) {
  const id = one(request.query, 'id');
  if (!id) return reply.send(failure(10, 'Parâmetro obrigatório ausente: id.'));

  const rawFormat = cleanText(one(request.query, 'format'), 32);
  if (rawFormat && rawFormat !== 'raw' && rawFormat !== 'm4a' && rawFormat !== 'aac') {
    return reply.send(failure(0, 'Formato de transcoding solicitado não é suportado.'));
  }

  const maxBitRateRaw = one(request.query, 'maxBitRate');
  const maxBitRate = maxBitRateRaw == null ? null : boundedInteger(maxBitRateRaw, 0, 320);
  if (maxBitRateRaw != null && (maxBitRate == null || maxBitRate < 32)) {
    return reply.send(failure(10, 'Parâmetro maxBitRate inválido.'));
  }

  const wantsTranscode = rawFormat === 'm4a' || rawFormat === 'aac' || maxBitRate != null;
  if (wantsTranscode) {
    if (!options.media.ffmpegAvailable) {
      return reply.send(failure(0, 'Transcoding não está disponível neste servidor.'));
    }
    const quality = transcodeQuality(maxBitRate ?? 160);
    try {
      const prepared = await options.media.prepareTranscode(id, quality, 'off');
      if (!prepared) return reply.send(failure(70, 'Música não encontrada.'));
      const info = await prepared.transcoded.stat();
      if (!info.isFile() || info.size <= 0) {
        await prepared.transcoded.close();
        return reply.send(failure(0, 'Áudio transcodificado não está disponível.'));
      }
      return sendOriginalRange(
        reply,
        { handle: prepared.transcoded, stat: { size: info.size } },
        'audio/mp4',
        request.headers.range
      );
    } catch {
      return reply.send(failure(0, 'Não foi possível preparar o áudio solicitado.'));
    }
  }

  const source = await options.media.openTrack(id);
  if (!source) return reply.send(failure(70, 'Música não encontrada.'));
  return sendOriginalRange(reply, source.opened, source.track.mimeType, request.headers.range);
}

