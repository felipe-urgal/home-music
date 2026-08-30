import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';

const HISTORY_CAPACITY = 2_000;
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));

type PlaybackHistoryRouteOptions = {
  databasePath?: string;
};

function validTrackId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64;
}

class PlaybackHistoryStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
  }

  close() {
    this.db.close();
  }

  record(userId: string, trackId: string, playedAt = new Date().toISOString()) {
    const track = this.db.prepare('SELECT 1 FROM tracks WHERE id = ? LIMIT 1;').get(trackId);
    if (!track) return false;

    this.db.exec('BEGIN IMMEDIATE;');
    try {
      this.db.prepare('INSERT INTO history(user_id, track_id, played_at) VALUES (?, ?, ?)')
        .run(userId, trackId, playedAt);
      this.db.prepare(`
        DELETE FROM history
        WHERE user_id = ?
          AND id NOT IN (
            SELECT id
            FROM history
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ${HISTORY_CAPACITY}
          )
      `).run(userId, userId);
      this.db.exec('COMMIT;');
      return true;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Preserva o erro original caso a transação já tenha sido encerrada.
      }
      throw error;
    }
  }
}

export function registerPlaybackHistoryRoutes(
  app: FastifyInstance,
  options: PlaybackHistoryRouteOptions = {}
) {
  const databasePath = options.databasePath
    || process.env.HOME_MUSIC_DATABASE_PATH
    || defaultDatabasePath;
  let store: PlaybackHistoryStore | null = null;
  const getStore = () => {
    store ??= new PlaybackHistoryStore(databasePath);
    return store;
  };

  app.addHook('onClose', async () => {
    store?.close();
  });

  app.post<{ Params: { id: string } }>('/api/history/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(409).send({ error: 'Histórico pessoal exige uma identidade persistida.' });
    }
    if (!validTrackId(request.params.id)) {
      return reply.code(404).send({ error: 'Música não encontrada.' });
    }
    if (!getStore().record(request.user.id, request.params.id)) {
      return reply.code(404).send({ error: 'Música não encontrada.' });
    }

    reply.header('Cache-Control', 'private, no-store');
    return reply.code(201).send({ recorded: true });
  });
}
