import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const configUrl = new URL('../.github/dependabot.yml', import.meta.url);

async function loadConfig() {
  return readFile(configUrl, 'utf8');
}

function occurrences(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

test('Dependabot monitora npm raiz, E2E e GitHub Actions semanalmente', async () => {
  const config = await loadConfig();

  assert.equal(occurrences(config, /package-ecosystem: "npm"/g), 2);
  assert.equal(occurrences(config, /package-ecosystem: "github-actions"/g), 1);
  assert.match(config, /directory: "\/"/);
  assert.match(config, /directory: "\/e2e"/);
  assert.equal(occurrences(config, /interval: "weekly"/g), 3);
  assert.equal(occurrences(config, /timezone: "America\/Sao_Paulo"/g), 3);
});

test('grupos automatizados aceitam somente minor e patch', async () => {
  const config = await loadConfig();

  assert.ok(occurrences(config, /applies-to: "version-updates"/g) >= 3);
  assert.ok(occurrences(config, /applies-to: "security-updates"/g) >= 2);
  assert.ok(occurrences(config, /- "minor"/g) >= 5);
  assert.ok(occurrences(config, /- "patch"/g) >= 5);
  assert.doesNotMatch(config, /- "major"/);
});

test('política de dependências não introduz auto-merge', async () => {
  const config = await loadConfig();

  assert.doesNotMatch(config, /auto[-_ ]?merge/i);
  assert.doesNotMatch(config, /automerge/i);
});
