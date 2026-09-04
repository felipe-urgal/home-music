import type { FastifyInstance, FastifyReply } from 'fastify';
import { ExternalProviderError } from './external-provider.js';
import {
  JAMENDO_CLIENT_ID_CONFIG,
  type JamendoProvider
} from './jamendo-provider.js';

type JamendoDiscoveryRouteOptions = Readonly<{
  provider: JamendoProvider;
  clientId: string;
}>;

function sendJamendoError(reply: FastifyReply, error: unknown) {
  if (error instanceof ExternalProviderError) {
    return reply.code(error.statusCode).send({ error: error.message });
  }
  throw error;
}

function config(options: JamendoDiscoveryRouteOptions) {
  return { [JAMENDO_CLIENT_ID_CONFIG]: options.clientId };
}

export function registerAdminJamendoDiscoveryRoutes(
  app: FastifyInstance,
  options: JamendoDiscoveryRouteOptions
) {
  app.get<{
    Querystring: { q?: unknown; page?: unknown; limit?: unknown };
  }>('/api/admin/imports/providers/jamendo/search', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      return await options.provider.search(
        {
          query: request.query?.q,
          page: request.query?.page,
          limit: request.query?.limit
        },
        config(options)
      );
    } catch (error) {
      return sendJamendoError(reply, error);
    }
  });

  app.post<{
    Body: { sourceId?: unknown } | null;
  }>('/api/admin/imports/providers/jamendo/eligibility', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    try {
      const track = await options.provider.inspectImportEligibility(
        request.body?.sourceId,
        config(options)
      );
      return { allowed: true, track };
    } catch (error) {
      return sendJamendoError(reply, error);
    }
  });
}
