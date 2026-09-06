import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify, { type FastifyRequest } from 'fastify';
import type {
  PersonalDataBundleV1,
  PersonalDataImportPreviewV1
} from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_IMPORT_LIMITS,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import type { PersonalDataImportPlan } from './personal-data-import-plan.js';
import { PersonalDataImportValidationError } from './personal-data-import-parser.js';
import { registerPersonalDataImportPreviewRoutes } from './personal-data-import-preview-routes.js';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function bundle(): PersonalDataBundleV1 {
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-06T12:00:00.000Z',
    favorites: [],
    manualPlaylists: [],
    smartPlaylists: [],
    libraryViews: [],
    playbackHistory: [],
    playbackState: {
      currentTrack: null,
      position: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'off',
      wasPlaying: false,
      baseQueue: [],
      queue: [],
      updatedAt: '2026-09-06T12:00:00.000Z'
    }
  };
}

function preview(): PersonalDataImportPreviewV1 {
  const emptyReferences = {
    total: 0,
    found: 0,
    missing: 0,
    ambiguous: 0,
    conflict: 0
  };
  return {
    format: PERSONAL_DATA_FORMAT,
    version: PERSONAL_DATA_VERSION,
    exportedAt: '2026-09-06T12:00:00.000Z',
    references: { ...emptyReferences },
    domains: {
      favorites: { items: 0, references: { ...emptyReferences } },
      manualPlaylists: { items: 0, references: { ...emptyReferences } },
      smartPlaylists: { items: 0 },
      libraryViews: { items: 0 },
      playbackHistory: { items: 0, references: { ...emptyReferences } },
      playbackState: { references: { ...emptyReferences } }
    },
    issues: [],
    issuesTruncated: false
  };
}

function plan(value: PersonalDataBundleV1 = bundle()): PersonalDataImportPlan {
  return { bundle: value, references: [], preview: preview() };
}

function authenticate(app: ReturnType<typeof Fastify>) {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    request.user = { id: USER_A, username: 'alice', role: 'user' };
  });
}

test('preview exige identidade persistida antes de executar o planner', async () => {
  const app = Fastify();
  let plannerCalls = 0;
  registerPersonalDataImportPreviewRoutes(app, {
    plan() {
      plannerCalls += 1;
      return plan();
    }
  });

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/preview',
      payload: bundle()
    });
    assert.equal(response.statusCode, 409);
    assert.equal(plannerCalls, 0);
  } finally {
    await app.close();
  }
});

test('preview autenticado é read-only, privado e não aceita userId como autoridade', async () => {
  const app = Fastify();
  const receivedBodies: unknown[] = [];
  registerPersonalDataImportPreviewRoutes(app, {
    plan(value) {
      receivedBodies.push(value);
      return plan(value as PersonalDataBundleV1);
    }
  });
  authenticate(app);

  try {
    const input = bundle();
    const response = await app.inject({
      method: 'POST',
      url: `/api/account/personal-data/import/preview?userId=${encodeURIComponent(USER_B)}`,
      payload: input
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(receivedBodies.length, 1);
    assert.deepEqual(receivedBodies[0], input);
    assert.equal(response.body.includes(USER_A), false);
    assert.equal(response.body.includes(USER_B), false);
  } finally {
    await app.close();
  }
});

test('erro de validação do parser vira resposta HTTP estável sem mensagem interna', async () => {
  const app = Fastify();
  registerPersonalDataImportPreviewRoutes(app, {
    plan() {
      throw new PersonalDataImportValidationError(
        'unsupported-version',
        '$.version',
        'detalhe interno que não deve ser serializado'
      );
    }
  });
  authenticate(app);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/preview',
      payload: bundle()
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'Bundle de dados pessoais inválido.',
      code: 'unsupported-version',
      field: '$.version'
    });
    assert.equal(response.body.includes('detalhe interno'), false);
  } finally {
    await app.close();
  }
});

test('JSON malformado recebe erro estável sem atravessar o planner', async () => {
  const app = Fastify();
  let plannerCalls = 0;
  registerPersonalDataImportPreviewRoutes(app, {
    plan() {
      plannerCalls += 1;
      return plan();
    }
  });
  authenticate(app);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/preview',
      headers: { 'content-type': 'application/json' },
      payload: '{"format":'
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: 'JSON de dados pessoais inválido.',
      code: 'invalid-json',
      field: '$'
    });
    assert.equal(plannerCalls, 0);
  } finally {
    await app.close();
  }
});

test('bodyLimit rejeita payload acima de 5 MiB com 413 estável antes do planner', async () => {
  const app = Fastify();
  let plannerCalls = 0;
  registerPersonalDataImportPreviewRoutes(app, {
    plan() {
      plannerCalls += 1;
      return plan();
    }
  });
  authenticate(app);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/preview',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(PERSONAL_DATA_IMPORT_LIMITS.maxBytes) })
    });
    assert.equal(response.statusCode, 413);
    assert.deepEqual(response.json(), {
      error: 'Bundle de dados pessoais excede o limite permitido.',
      code: 'payload-too-large',
      field: '$'
    });
    assert.equal(plannerCalls, 0);
  } finally {
    await app.close();
  }
});
