import type { FastifyInstance } from 'fastify';
import type { LibraryAssistantAutonomyController } from './library-assistant-autonomy.js';

export function registerLibraryAssistantAutonomyRoutes(app: FastifyInstance, controller: LibraryAssistantAutonomyController) {
  app.get('/api/admin/library-assistant/autonomy', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return controller.state();
  });

  app.put<{ Body: unknown }>('/api/admin/library-assistant/autonomy', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      return controller.configure(request.body);
    } catch (error) {
      if (error instanceof TypeError || error instanceof RangeError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }
  });
}
