import type { FastifyInstance } from 'fastify';
import type { HeavyWorkQueue } from './heavy-work-queue.js';
import type { LibraryRouteProjection } from './library-routes.js';
import type { LibraryService } from './library-service.js';
import { LibraryAssistantProviderGateway } from './library-assistant-provider.js';
import { registerLibraryAssistantRoutes } from './library-assistant-routes.js';
import { LibraryAssistantService, type LibraryAssistantAnalyzer } from './library-assistant-service.js';
import { LibraryAssistantStore } from './library-assistant-store.js';
import type { LongJobObservability } from './long-job-observability.js';

type LibraryAssistantBootstrapOptions = {
  databasePath: string;
  library: LibraryService;
  projection: LibraryRouteProjection;
  queue: HeavyWorkQueue;
  observability: LongJobObservability;
  analyzers?: readonly LibraryAssistantAnalyzer[];
};

export function registerLibraryAssistant(
  app: FastifyInstance,
  options: LibraryAssistantBootstrapOptions
) {
  const store = new LibraryAssistantStore(options.databasePath);
  const providers = new LibraryAssistantProviderGateway(store);
  const service = new LibraryAssistantService({
    store,
    queue: options.queue,
    observability: options.observability,
    providers,
    analyzers: options.analyzers,
    library: {
      listTracks: () => options.projection.projectTracks(options.library.listPublicTracks()),
      revision: () => options.projection.projectRevision(options.library.status().revision)
    }
  });

  registerLibraryAssistantRoutes(app, service);
  app.addHook('onClose', async () => {
    await service.close();
    store.close();
  });

  return service;
}
