import type { FastifyInstance } from 'fastify';
import { registerLibraryViewRoutes } from './library-view-routes.js';
import { registerPlaybackHistoryRoutes } from './playback-history-routes.js';
import { registerSmartPlaylistRoutes } from './smart-playlist-routes.js';

export function registerPhase10Routes(app: FastifyInstance, databasePath: string) {
  registerPlaybackHistoryRoutes(app, { databasePath });
  registerSmartPlaylistRoutes(app, { databasePath });
  registerLibraryViewRoutes(app, { databasePath });
}
