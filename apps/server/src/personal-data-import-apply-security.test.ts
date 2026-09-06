import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify, { type FastifyRequest } from 'fastify';
import type {
  PersonalDataBundleV1,
  PersonalDataImportApplySummaryV1,
  PersonalDataImportPreviewV1
} from '@home-music/shared/personal-data';
import {
  PERSONAL_DATA_FORMAT,
  PERSONAL_DATA_IMPORT_LIMITS,
  PERSONAL_DATA_VERSION
} from '@home-music/shared/personal-data';
import { registerPersonalDataImportApplyRoutes } from './personal-data-import-apply-routes.js';
import { personalDataImportConfirmationToken } from './personal-data-import-confirmation.js';
import type { PersonalDataImportPlan } from './personal-data-import-plan.js';

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

function preview(value: PersonalDataBundleV1): PersonalDataImportPreviewV1 {
  const empty = { total: 0, found: 0, missing: 0, ambiguous: 0, conflict: 0 };
  return {
    format: value.format,
    version: value.version,
    exportedAt: value.exportedAt,
    references: empty,
    domains: {
      favorites: { items: 0, references: empty },
      manualPlaylists: { items: 0, references: empty },
      smartPlaylists: { items: 0 },
      libraryViews: { items: 0 },
      playbackHistory: { items: 0, references: empty },
      playbackState: { references: empty }
    },
    issues: [],
    issuesTruncated: false
  };
}

function plan(value = bundle()): PersonalDataImportPlan {
  return { bundle: value, references: [], preview: preview(value) };
}

function summary(): PersonalDataImportApplySummaryV1 {
  const empty = { applied: 0, ignored: 0 };
  return {
    applied: 0,
    ignored: 0,
    missing: 0,
    ambiguous: 0,
    conflict: 0,
    failed: 0,
    domains: {
      favorites: empty,
      manualPlaylists: empty,
      smartPlaylists: empty,
      libraryViews: empty,
      playbackHistory: empty,
      playbackState: empty
    }
  };
}

function authenticate(app: ReturnType<typeof Fastify>, userId = USER_A) {
  app.addHook('preHandler', async (request: FastifyRequest) => {
    request.user = { id: userId, username: 'alice', role: 'user' };
  });
}

test('apply exige autenticação antes do planner/applier', async () => {
  const app = Fastify();
  let plannerCalls = 0;
  let applyCalls = 0;
  registerPersonalDataImportApplyRoutes(
    app,
    {
      plan() {
        plannerCalls += 1;
        return plan();
      }
    },
    {
      apply() {
        applyCalls += 1;
        return summary();
      }
    }
  );

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/apply',
      payload: { bundle: bundle(), confirmed: true, confirmationToken: 'a'.repeat(64) }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(plannerCalls, 0);
    assert.equal(applyCalls, 0);
  } finally {
    await app.close();
  }
});

test('apply exige confirmação explícita antes do planner/applier', async () => {
  const app = Fastify();
  let plannerCalls = 0;
  let applyCalls = 0;
  registerPersonalDataImportApplyRoutes(
    app,
    {
      plan() {
        plannerCalls += 1;
        return plan();
      }
    },
    {
      apply() {
        applyCalls += 1;
        return summary();
      }
    }
  );
  authenticate(app);

  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/apply',
      payload: { bundle: bundle(), confirmed: false, confirmationToken: 'a'.repeat(64) }
    });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'confirmation-required');
    assert.equal(plannerCalls, 0);
    assert.equal(applyCalls, 0);
  } finally {
    await app.close();
  }
});

test('apply usa somente usuário autenticado e aceita apenas token do mesmo plano', async () => {
  const app = Fastify();
  const currentPlan = plan();
  const appliedUsers: string[] = [];
  registerPersonalDataImportApplyRoutes(
    app,
    { plan: () => currentPlan },
    {
      apply(userId) {
        appliedUsers.push(userId);
        return summary();
      }
    }
  );
  authenticate(app);

  try {
    const token = personalDataImportConfirmationToken(USER_A, currentPlan);
    const response = await app.inject({
      method: 'POST',
      url: `/api/account/personal-data/import/apply?userId=${encodeURIComponent(USER_B)}`,
      payload: { bundle: currentPlan.bundle, confirmed: true, confirmationToken: token }
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(appliedUsers, [USER_A]);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.body.includes(USER_A), false);
    assert.equal(response.body.includes(USER_B), false);
  } finally {
    await app.close();
  }
});

test('token de outro usuário ou plano alterado bloqueia mutação', async () => {
  const app = Fastify();
  const currentPlan = plan();
  let applyCalls = 0;
  registerPersonalDataImportApplyRoutes(
    app,
    { plan: () => currentPlan },
    {
      apply() {
        applyCalls += 1;
        return summary();
      }
    }
  );
  authenticate(app);

  try {
    const otherUserToken = personalDataImportConfirmationToken(USER_B, currentPlan);
    const wrongUser = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/apply',
      payload: {
        bundle: currentPlan.bundle,
        confirmed: true,
        confirmationToken: otherUserToken
      }
    });
    assert.equal(wrongUser.statusCode, 409);
    assert.equal(wrongUser.json().code, 'preview-changed');
    assert.equal(applyCalls, 0);

    const reviewed = plan();
    const reviewedToken = personalDataImportConfirmationToken(USER_A, reviewed);
    currentPlan.bundle.playbackState.volume = 0.5;
    const drifted = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/apply',
      payload: {
        bundle: currentPlan.bundle,
        confirmed: true,
        confirmationToken: reviewedToken
      }
    });
    assert.equal(drifted.statusCode, 409);
    assert.equal(drifted.json().code, 'preview-changed');
    assert.equal(applyCalls, 0);
  } finally {
    await app.close();
  }
});

test('bundle aninhado acima de 5 MiB falha antes do planner', async () => {
  const app = Fastify();
  let plannerCalls = 0;
  registerPersonalDataImportApplyRoutes(
    app,
    {
      plan() {
        plannerCalls += 1;
        return plan();
      }
    },
    { apply: () => summary() }
  );
  authenticate(app);

  try {
    const oversized = {
      ...bundle(),
      padding: 'x'.repeat(PERSONAL_DATA_IMPORT_LIMITS.maxBytes)
    };
    const response = await app.inject({
      method: 'POST',
      url: '/api/account/personal-data/import/apply',
      payload: {
        bundle: oversized,
        confirmed: true,
        confirmationToken: 'a'.repeat(64)
      }
    });
    assert.equal(response.statusCode, 413);
    assert.equal(response.json().code, 'payload-too-large');
    assert.equal(plannerCalls, 0);
  } finally {
    await app.close();
  }
});
