import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerAdminJamendoDiscoveryRoutes } from './admin-jamendo-discovery-routes.js';
import { JamendoProvider } from './jamendo-provider.js';

function apiResponse(results: unknown[]) {
  return new Response(JSON.stringify({
    headers: { status: 'success', results_count: results.length, results_fullcount: results.length },
    results
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function allowedTrack(overrides: Record<string, unknown> = {}) {
  return {
    id: '123',
    name: 'Faixa livre',
    artist_name: 'Artista livre',
    album_name: 'Álbum livre',
    duration: 180,
    license_ccurl: 'https://creativecommons.org/licenses/by/4.0/',
    audiodownload_allowed: true,
    audio: 'https://example.invalid/preview',
    ...overrides
  };
}

test('rota Jamendo consulta provider sem devolver client_id', async () => {
  const app = Fastify();
  const secret = 'route-secret-client-id';
  const provider = new JamendoProvider({ fetch: async () => apiResponse([]) });
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
      return apiResponse([]);
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

test('rota de elegibilidade revalida faixa permitida pelo sourceId', async () => {
  const app = Fastify();
  const provider = new JamendoProvider({ fetch: async () => apiResponse([allowedTrack()]) });
  registerAdminJamendoDiscoveryRoutes(app, { provider, clientId: 'configured' });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/imports/providers/jamendo/eligibility',
      payload: { sourceId: '123' }
    });
    assert.equal(response.statusCode, 200);
    const payload = response.json();
    assert.equal(payload.allowed, true);
    assert.equal(payload.track.sourceId, '123');
    assert.equal(payload.track.importAllowed, true);
    assert.equal(payload.track.attribution, '“Faixa livre” — Artista livre · Jamendo');
  } finally {
    await app.close();
  }
});

test('rota de elegibilidade bloqueia faixa sem permissão de download', async () => {
  const app = Fastify();
  const provider = new JamendoProvider({
    fetch: async () => apiResponse([allowedTrack({ audiodownload_allowed: false })])
  });
  registerAdminJamendoDiscoveryRoutes(app, { provider, clientId: 'configured' });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/imports/providers/jamendo/eligibility',
      payload: { sourceId: '123' }
    });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), { error: 'Esta faixa não permite download pela API do Jamendo.' });
  } finally {
    await app.close();
  }
});
