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


test('workflows usam actions pinadas por SHA', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const workflowsDir = path.join(root, '.github', 'workflows');
  for (const name of await readdir(workflowsDir)) {
    if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
    const source = await readFile(path.join(workflowsDir, name), 'utf8');
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)) {
      const ref = match[1] || '';
      if (ref.startsWith('./') || ref.startsWith('docker://')) continue;
      assert.match(ref, /@[0-9a-f]{40}$/i, `${name}: action não pinada por SHA: ${ref}`);
    }
  }
});

test('referências operacionais canônicas apontam para arquivos existentes', async () => {
  const { access, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const files = [
    'AGENTS.md',
    'README.md',
    'apps/server/AGENTS.md',
    'apps/web/AGENTS.md',
    'e2e/AGENTS.md',
    'scripts/AGENTS.md'
  ];
  const refs = new Set();
  for (const relative of files) {
    const source = await readFile(path.join(root, relative), 'utf8');
    for (const match of source.matchAll(/(?:^|[\s(`])((?:docs|e2e)\/[A-Za-z0-9_./-]+\.(?:md|json))/g)) {
      refs.add(match[1]);
    }
  }
  const production = JSON.parse(await readFile(path.join(root, '.dev-dashboard/production.json'), 'utf8'));
  refs.add(production.production.documentation);
  for (const relative of refs) await access(path.join(root, relative));
});
