import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveBootstrapEnvFile } from './bootstrap-preload-env.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('resolve o .env raiz por padrão em produção', () => {
  const result = resolveBootstrapEnvFile({ nodeEnv: 'production', configuredEnvFile: '' });

  assert.equal(result.isProduction, true);
  assert.equal(result.envFilename, '.env');
  assert.equal(result.envPath, path.join(repositoryRoot, '.env'));
  assert.equal(result.source, 'default');
});

test('resolve o .env.development raiz fora de produção', () => {
  const result = resolveBootstrapEnvFile({ nodeEnv: 'development', configuredEnvFile: '   ' });

  assert.equal(result.isProduction, false);
  assert.equal(result.envFilename, '.env.development');
  assert.equal(result.envPath, path.join(repositoryRoot, '.env.development'));
  assert.equal(result.source, 'default');
});

test('usa arquivo de ambiente absoluto configurado explicitamente', () => {
  const configuredEnvFile = path.join(repositoryRoot, 'tmp', 'e2e.env');
  const result = resolveBootstrapEnvFile({
    nodeEnv: 'production',
    configuredEnvFile: `  ${configuredEnvFile}  `
  });

  assert.equal(result.isProduction, true);
  assert.equal(result.envFilename, '.env');
  assert.equal(result.envPath, configuredEnvFile);
  assert.equal(result.source, 'configured');
});

test('rejeita HOME_MUSIC_ENV_FILE relativo para evitar resolução dependente do cwd', () => {
  assert.throws(
    () => resolveBootstrapEnvFile({ nodeEnv: 'production', configuredEnvFile: './e2e.env' }),
    /HOME_MUSIC_ENV_FILE deve apontar para um caminho absoluto/
  );
});
