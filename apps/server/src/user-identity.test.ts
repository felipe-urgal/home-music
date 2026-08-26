import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUsername, USERNAME_MAX_CHARACTERS } from './user-identity.js';

test('normalizeUsername aplica trim, NFKC e lowercase somente na chave normalizada', () => {
  assert.deepEqual(normalizeUsername('  Ｆｅｌｉｐｅ Silva  '), {
    username: 'Felipe Silva',
    usernameNormalized: 'felipe silva'
  });
});

test('normalizeUsername preserva unicode válido e normaliza equivalentes canônicos', () => {
  const composed = normalizeUsername('José');
  const decomposed = normalizeUsername('Jose\u0301');

  assert.deepEqual(composed, {
    username: 'José',
    usernameNormalized: 'josé'
  });
  assert.deepEqual(decomposed, composed);
});

test('normalizeUsername rejeita vazio, caracteres de controle e limite excedido', () => {
  assert.equal(normalizeUsername('   '), null);
  assert.equal(normalizeUsername('nome\nquebrado'), null);
  assert.equal(normalizeUsername('nome\u007fquebrado'), null);
  assert.equal(normalizeUsername('a'.repeat(USERNAME_MAX_CHARACTERS + 1)), null);
});

test('normalizeUsername mede limite por caracteres unicode, não por bytes UTF-8', () => {
  const valid = 'á'.repeat(USERNAME_MAX_CHARACTERS);
  const invalid = `${valid}á`;

  assert.deepEqual(normalizeUsername(valid), {
    username: valid,
    usernameNormalized: valid
  });
  assert.equal(normalizeUsername(invalid), null);
});
