import assert from 'node:assert/strict';
import test from 'node:test';
import { LEGACY_ADMIN_OPERATIONS, resolveApiAccess } from './api-access.js';

test('operações administrativas históricas exigem admin mesmo sem config local', () => {
  for (const operation of LEGACY_ADMIN_OPERATIONS) {
    assert.equal(resolveApiAccess(operation.method, operation.path), 'admin');
    assert.equal(resolveApiAccess(operation.method, `${operation.path}?probe=1`), 'admin');
    assert.equal(resolveApiAccess(operation.method, operation.path, 'public'), 'admin');
  }
});

test('HEAD herda proteção administrativa de GET para diagnóstico detalhado', () => {
  assert.equal(resolveApiAccess('HEAD', '/api/health'), 'admin');
});

test('namespace /api/admin é sempre administrativo, inclusive contra config permissivo', () => {
  assert.equal(resolveApiAccess('GET', '/api/admin'), 'admin');
  assert.equal(resolveApiAccess('GET', '/api/admin/users'), 'admin');
  assert.equal(resolveApiAccess('POST', '/api/admin/users', 'public'), 'admin');
});

test('prefixos parecidos não são confundidos com namespace administrativo', () => {
  assert.equal(resolveApiAccess('GET', '/api/administrator'), 'authenticated');
  assert.equal(resolveApiAccess('GET', '/api/administer/users'), 'authenticated');
});

test('rotas comuns continuam authenticated por padrão e public quando declaradas', () => {
  assert.equal(resolveApiAccess('GET', '/api/library'), 'authenticated');
  assert.equal(resolveApiAccess('GET', '/api/auth/status', 'public'), 'public');
  assert.equal(resolveApiAccess('POST', '/api/auth/login', 'public'), 'public');
});
