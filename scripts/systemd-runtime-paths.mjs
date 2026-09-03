#!/usr/bin/env node
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

function fail(message) {
  throw new Error(message);
}

function hasUnsafeLineBreak(value) {
  return value.includes('\0') || value.includes('\n') || value.includes('\r');
}

function isSameOrInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function main() {
  const rootArgument = process.argv[2];
  const envArgument = process.argv[3];
  if (!rootArgument || !envArgument) {
    fail('Uso: systemd-runtime-paths.mjs <root-dir> <env-file>.');
  }

  const rootDir = realpathSync(path.resolve(rootArgument));
  const envPath = path.resolve(envArgument);
  const parsed = parseEnv(readFileSync(envPath, 'utf8'));

  const configuredValue = name => {
    const value = parsed[name];
    if (typeof value !== 'string') return '';
    if (hasUnsafeLineBreak(value)) fail(`${name} contém caractere inválido para um path de runtime.`);
    return value.trim();
  };

  const resolveConfiguredPath = (name, fallback) => {
    const configured = configuredValue(name);
    return path.resolve(rootDir, configured || fallback);
  };

  const assertWritableScope = (candidate, label) => {
    const filesystemRoot = path.parse(candidate).root;
    if (candidate === filesystemRoot) {
      fail(`${label} não pode liberar escrita na raiz do filesystem.`);
    }
    if (candidate === rootDir) {
      fail(`${label} não pode exigir escrita no diretório raiz do projeto.`);
    }
    if (isSameOrInside(candidate, rootDir)) {
      fail(`${label} não pode conter o diretório raiz do projeto.`);
    }
  };

  const prepareDirectory = (candidate, label) => {
    assertWritableScope(candidate, label);
    mkdirSync(candidate, { recursive: true, mode: 0o700 });
    const resolved = realpathSync(candidate);
    assertWritableScope(resolved, label);
    return resolved;
  };

  const writable = [];
  const addWritable = candidate => {
    if (!writable.includes(candidate)) writable.push(candidate);
  };

  const dataDir = prepareDirectory(path.join(rootDir, 'data'), 'data/');
  addWritable(dataDir);

  const musicValue = configuredValue('MUSIC_DIR');
  if (musicValue) {
    const musicCandidate = path.resolve(rootDir, musicValue);
    assertWritableScope(musicCandidate, 'MUSIC_DIR');
    const info = statSync(musicCandidate);
    if (!info.isDirectory()) fail('MUSIC_DIR precisa apontar para um diretório existente.');
    const musicDir = realpathSync(musicCandidate);
    assertWritableScope(musicDir, 'MUSIC_DIR');
    addWritable(musicDir);
  }

  const databasePath = resolveConfiguredPath('HOME_MUSIC_DATABASE_PATH', 'data/home-music.db');
  const databaseDir = prepareDirectory(path.dirname(databasePath), 'HOME_MUSIC_DATABASE_PATH');
  addWritable(databaseDir);

  const stagingDir = prepareDirectory(
    resolveConfiguredPath('HOME_MUSIC_IMPORT_STAGING_DIR', 'data/import-staging'),
    'HOME_MUSIC_IMPORT_STAGING_DIR'
  );
  addWritable(stagingDir);

  const scratchDir = prepareDirectory(
    resolveConfiguredPath('HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR', 'data/provider-scratch'),
    'HOME_MUSIC_EXTERNAL_PROVIDER_SCRATCH_DIR'
  );
  addWritable(scratchDir);

  const minimalWritable = writable.filter((candidate, index) =>
    !writable.some((other, otherIndex) => otherIndex !== index && isSameOrInside(other, candidate))
  );

  process.stdout.write(`${minimalWritable.join('\n')}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erro: ${message}`);
  process.exitCode = 1;
}
