import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REVIEWED_LIFECYCLE_PACKAGES = {
  'package-lock.json': [
    'node_modules/esbuild',
    'node_modules/fsevents'
  ],
  'e2e/package-lock.json': [
    'node_modules/fsevents'
  ]
};

function loadJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT_DIR, relativePath), 'utf8'));
}

function lifecyclePackages(lockfilePath) {
  const lockfile = loadJson(lockfilePath);
  return Object.entries(lockfile.packages ?? {})
    .filter(([, metadata]) => metadata?.hasInstallScript === true)
    .map(([packagePath]) => packagePath)
    .sort();
}

function npmConfig(relativePath) {
  return readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

test('disables dependency lifecycle scripts for root and e2e installs', () => {
  assert.match(npmConfig('.npmrc'), /^ignore-scripts=true$/m);
  assert.match(npmConfig('e2e/.npmrc'), /^ignore-scripts=true$/m);
});

for (const [lockfilePath, reviewedPackages] of Object.entries(REVIEWED_LIFECYCLE_PACKAGES)) {
  test(`${lockfilePath} keeps lifecycle scripts limited to the reviewed inventory`, () => {
    assert.deepEqual(lifecyclePackages(lockfilePath), [...reviewedPackages].sort());
  });
}
