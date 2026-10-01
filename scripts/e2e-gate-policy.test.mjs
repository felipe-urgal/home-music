import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function referencedSpecs(source) {
  return [...source.matchAll(/tests\/([A-Za-z0-9._-]+\.spec\.ts)/g)]
    .map(match => `e2e/tests/${match[1]}`);
}

test('critical E2E script only references existing specs', () => {
  const pkg = JSON.parse(read('e2e/package.json'));
  const refs = referencedSpecs(String(pkg.scripts?.['test:critical'] || ''));
  assert.ok(refs.length >= 4, 'critical gate must keep a meaningful regression set');
  for (const relativePath of refs) {
    assert.ok(existsSync(path.join(ROOT_DIR, relativePath)), `missing critical E2E spec: ${relativePath}`);
  }
});

test('CI explicit E2E references point to existing specs', () => {
  const refs = referencedSpecs(read('.github/workflows/ci.yml'));
  assert.ok(refs.length > 0, 'CI should list specialized E2E specs');
  for (const relativePath of refs) {
    assert.ok(existsSync(path.join(ROOT_DIR, relativePath)), `missing CI E2E spec: ${relativePath}`);
  }
});
