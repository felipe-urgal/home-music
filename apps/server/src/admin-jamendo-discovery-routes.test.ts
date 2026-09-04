import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminJamendoDiscoveryRoutes } from './admin-jamendo-discovery-routes.js';
import { JamendoProvider } from './jamendo-provider.js';

function successResponse() {
  return new Response(JSON.stringify({
    headers: { status: 'success', results_count: 0, results_fullcount: 0 },
    results: []
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

test('rota Jamendo consulta provider sem devolver client_id', async () => {
  const app = Fastify();
  const secret = 'route-secret-client-id';
  const provider = new JamendoProvider({ fetch: async () => successResponse() });
  registerAdminJamendoDiscoveryRoutes(app, { provider, clientId: secret });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/imports/providers/jamendo/search?q=ambient&page=1&limit=20'
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.body.includes(secret), false);
    assert.deepEqual(response.json(), {
      items: [],
      pagination: { page: 1, limit: 20, total: 0, nextPage: null }
    });
  } finally {
    await app.close();
  }
});

test('rota Jamendo responde 503 sem client_id e não tenta rede pública', async () => {
  const app = Fastify();
  let calls = 0;
  const provider = new JamendoProvider({
    fetch: async () => {
      calls += 1;
      return successResponse();
    }
  });
  registerAdminJamendoDiscoveryRoutes(app, { provider, clientId: '' });

  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/imports/providers/jamendo/search?q=ambient'
    });
    assert.equal(response.statusCode, 503);
    assert.equal(calls, 0);
    assert.deepEqual(response.json(), { error: 'O provider Jamendo não está configurado.' });
  } finally {
    await app.close();
  }
});
