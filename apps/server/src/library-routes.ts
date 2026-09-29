import type { TrackHotCues, TrackRhythmOverride } from '@home-music/shared';
import type { FastifyInstance } from 'fastify';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import {
  LibraryHttpSnapshotCache,
  matchesIfNoneMatch,
  selectLibraryContentEncoding
} from './library-http-cache.js';
import type { LibraryService } from './library-service.js';


function parseTrackHotCues(value: unknown): TrackHotCues | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TrackHotCues>;
  if (
    candidate.version !== 1
    || !Array.isArray(candidate.positions)
    || candidate.positions.length !== 4
    || candidate.positions.some(position => position != null && (
      typeof position !== 'number'
      || !Number.isFinite(position)
      || position < 0
    ))
  ) return null;

  return {
    version: 1,
    positions: [...candidate.positions] as TrackHotCues['positions']
  };
}

function parseTrackRhythmOverride(value: unknown): TrackRhythmOverride | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<TrackRhythmOverride>;
  const downbeatSeconds = candidate.downbeatSeconds ?? null;
  const beatsPerBar = candidate.beatsPerBar ?? null;
  const hasDownbeat = downbeatSeconds != null || beatsPerBar != null;
  if (
    candidate.version !== 1
    || typeof candidate.bpm !== 'number'
    || !Number.isFinite(candidate.bpm)
    || candidate.bpm < 20
    || candidate.bpm > 300
    || typeof candidate.firstBeatSeconds !== 'number'
    || !Number.isFinite(candidate.firstBeatSeconds)
    || candidate.firstBeatSeconds < 0
    || (
      hasDownbeat
      && (
        typeof downbeatSeconds !== 'number'
        || !Number.isFinite(downbeatSeconds)
        || downbeatSeconds < 0
        || (beatsPerBar !== 3 && beatsPerBar !== 4)
      )
    )
  ) return null;

  return {
    version: 1,
    bpm: candidate.bpm,
    firstBeatSeconds: candidate.firstBeatSeconds,
    ...(hasDownbeat ? { downbeatSeconds, beatsPerBar } : {})
  };
}

export type LibraryRouteProjection = {
  projectTracks: (
    tracks: ReturnType<LibraryService['listPublicTracks']>
  ) => ReturnType<LibraryService['listPublicTracks']>;
  projectRevision: (revision: number) => number;
};

export function registerLibraryRoutes(
  app: FastifyInstance,
  library: LibraryService,
  integrityQueue?: HeavyWorkQueue,
  projection?: LibraryRouteProjection
) {
  const source = {
    listPublicTracks: () => {
      const tracks = library.listPublicTracks();
      return projection ? projection.projectTracks(tracks) : tracks;
    },
    status: () => {
      const status = library.status();
      return projection
        ? { ...status, revision: projection.projectRevision(status.revision) }
        : status;
    }
  };
  const libraryHttpCache = new LibraryHttpSnapshotCache(source);

  app.get('/api/library', async (request, reply) => {
    const snapshot = libraryHttpCache.snapshot();
    reply.header('Cache-Control', 'private, no-cache');
    reply.header('ETag', snapshot.etag);
    reply.header('Vary', 'Accept-Encoding');

    if (matchesIfNoneMatch(request.headers['if-none-match'], snapshot.etag)) {
      return reply.code(304).send();
    }

    const encoding = selectLibraryContentEncoding(
      request.headers['accept-encoding'],
      snapshot.body.byteLength
    );
    const body = await libraryHttpCache.bodyFor(snapshot, encoding);
    reply.type('application/json; charset=utf-8');
    if (encoding !== 'identity') reply.header('Content-Encoding', encoding);
    return reply.send(body);
  });

  app.get('/api/library/status', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return source.status();
  });

  app.post('/api/library/scan', async (_request, reply) => {
    const result = await library.rescan('manual');
    reply.header('Cache-Control', 'no-store');
    return result;
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/tracks/:id/rhythm-override', async (request, reply) => {
    const override = parseTrackRhythmOverride(request.body);
    if (!override) {
      return reply.code(400).send({ error: 'Correção manual do beat grid inválida.' });
    }
    const track = library.setRhythmOverride(request.params.id, override);
    if (!track) return reply.code(404).send({ error: 'Faixa não encontrada.' });
    reply.header('Cache-Control', 'private, no-store');
    return { track };
  });

  app.delete<{ Params: { id: string } }>('/api/tracks/:id/rhythm-override', async (request, reply) => {
    const track = library.resetRhythmOverride(request.params.id);
    if (!track) return reply.code(404).send({ error: 'Faixa não encontrada.' });
    reply.header('Cache-Control', 'private, no-store');
    return { track };
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/tracks/:id/hot-cues', async (request, reply) => {
    const hotCues = parseTrackHotCues(request.body);
    if (!hotCues) {
      return reply.code(400).send({ error: 'Hot Cues inválidos.' });
    }

    const current = library.getTrack(request.params.id);
    if (!current) return reply.code(404).send({ error: 'Faixa não encontrada.' });
    if (
      current.duration != null
      && hotCues.positions.some(position => position != null && position > current.duration!)
    ) {
      return reply.code(400).send({ error: 'Hot Cue fora da duração da faixa.' });
    }

    const track = library.setHotCues(request.params.id, hotCues);
    if (!track) return reply.code(404).send({ error: 'Faixa não encontrada.' });
    reply.header('Cache-Control', 'private, no-store');
    return { track };
  });

  app.get('/api/admin/library/overview', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return library.overview();
  });

  app.post('/api/admin/library/integrity/check', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const overview = integrityQueue
      ? await integrityQueue.run(() => library.checkIntegrity())
      : await library.checkIntegrity();
    if (!overview) {
      return reply.code(409).send({
        error: 'Biblioteca não está pronta para verificação de integridade.'
      });
    }
    return overview;
  });
}
