import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { TvRemoteCommand, TvRemoteEvent, TvRemotePlaybackSnapshot } from '@home-music/shared';
import type { TvRemoteSessionManager } from './tv-remote-session-manager.js';

type SessionParams = { Params: { sessionId: string } };
const missing = { error: 'Controle remoto não encontrado.' };

function parseCommand(value: unknown): TvRemoteCommand | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (body.type === 'toggle-play' || body.type === 'previous' || body.type === 'next') {
    return Object.keys(body).length === 1 ? { type: body.type } : null;
  }
  if (body.type === 'seek' && (body.deltaSeconds === -10 || body.deltaSeconds === 10)) {
    return Object.keys(body).length === 2 ? { type: 'seek', deltaSeconds: body.deltaSeconds } : null;
  }
  return null;
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function parseSnapshot(value: unknown): TvRemotePlaybackSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length !== 7
    || !nullableString(body.trackId) || !nullableString(body.title) || !nullableString(body.artist)
    || typeof body.playing !== 'boolean'
    || typeof body.currentTime !== 'number' || !Number.isFinite(body.currentTime)
    || typeof body.duration !== 'number' || !Number.isFinite(body.duration)
    || typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) return null;
  const duration = Math.max(0, body.duration);
  const currentTime = Math.max(0, body.currentTime);
  return {
    trackId: body.trackId,
    title: body.title?.trim() ?? null,
    artist: body.artist?.trim() ?? null,
    playing: body.playing,
    currentTime: duration > 0 ? Math.min(currentTime, duration) : currentTime,
    duration,
    updatedAt: new Date(body.updatedAt).toISOString()
  };
}

async function requireIdentity(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) return reply.code(401).send({ error: 'Sessão expirada ou autenticação necessária.' });
}

export function registerTvRemoteRoutes(app: FastifyInstance, manager: TvRemoteSessionManager) {
  const streams = new Set<() => void>();
  // onClose runs after HTTP connections finish; drain SSE before that phase.
  app.addHook('preClose', async () => {
    for (const close of [...streams]) close();
  });
  const options = { preHandler: requireIdentity };

  app.post('/api/tv-remote/sessions', options, async (request, reply) => {
    if (request.body !== undefined && (!request.body || typeof request.body !== 'object'
      || Array.isArray(request.body) || Object.keys(request.body).length !== 0)) {
      return reply.code(400).send({ error: 'Requisição de controle remoto inválida.' });
    }
    return reply.code(201).send(manager.create(request.user!.id));
  });

  app.get<SessionParams>('/api/tv-remote/sessions/:sessionId', options, async (request, reply) => {
    const session = manager.get(request.user!.id, request.params.sessionId);
    return session ?? reply.code(404).send(missing);
  });

  app.put<SessionParams>('/api/tv-remote/sessions/:sessionId/status', options, async (request, reply) => {
    const ownerId = request.user!.id;
    const sessionId = request.params.sessionId;
    if (!manager.get(ownerId, sessionId)) return reply.code(404).send(missing);
    const snapshot = parseSnapshot(request.body);
    if (!snapshot) return reply.code(400).send({ error: 'Estado do controle remoto inválido.' });
    if (!manager.publishSnapshot(ownerId, sessionId, snapshot)) return reply.code(404).send(missing);
    return reply.code(204).send();
  });

  app.post<SessionParams>('/api/tv-remote/sessions/:sessionId/commands', options, async (request, reply) => {
    const ownerId = request.user!.id;
    const sessionId = request.params.sessionId;
    if (!manager.get(ownerId, sessionId)) return reply.code(404).send(missing);
    const command = parseCommand(request.body);
    if (!command) return reply.code(400).send({ error: 'Comando de controle remoto inválido.' });
    if (!manager.publishCommand(ownerId, sessionId, command)) return reply.code(404).send(missing);
    return reply.code(202).send();
  });

  app.delete<SessionParams>('/api/tv-remote/sessions/:sessionId', options, async (request, reply) => {
    if (!manager.close(request.user!.id, request.params.sessionId)) return reply.code(404).send(missing);
    return reply.code(204).send();
  });

  app.get<SessionParams>('/api/tv-remote/sessions/:sessionId/events', options, async (request, reply) => {
    const ownerId = request.user!.id;
    const sessionId = request.params.sessionId;
    if (!manager.get(ownerId, sessionId)) return reply.code(404).send(missing);
    const header = request.headers['last-event-id'];
    const lastEventId = header === undefined ? 0 : Number(header);
    if ((header !== undefined && (typeof header !== 'string' || !/^\d+$/.test(header)))
      || !Number.isSafeInteger(lastEventId) || lastEventId < 0) {
      return reply.code(400).send({ error: 'Identificador de evento inválido.' });
    }
    const replay = manager.eventsAfter(ownerId, sessionId, lastEventId);
    if (!replay) return reply.code(404).send(missing);
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let unsubscribe: (() => void) | null = null;
    let closed = false;
    const close = (destroy = false) => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      streams.delete(close);
      request.raw.off('close', close);
      reply.raw.off('close', close);
      if (destroy) reply.raw.destroy();
      else reply.raw.end();
    };
    const writeFrame = (frame: string) => {
      if (!closed && !reply.raw.write(frame)) close(true);
    };
    const write = (event: TvRemoteEvent) => {
      if (closed) return;
      writeFrame(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (event.type === 'closed') close();
    };
    unsubscribe = manager.subscribe(ownerId, sessionId, write);
    if (!unsubscribe) return reply.code(404).send(missing);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    });
    streams.add(close);
    request.raw.once('close', close);
    reply.raw.once('close', close);
    writeFrame('retry: 3000\n\n');
    for (const event of replay) write(event);
    if (!closed) {
      heartbeat = setInterval(() => writeFrame(': heartbeat\n\n'), 15_000);
      heartbeat.unref();
    }
  });
}
