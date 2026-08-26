import assert from 'node:assert/strict';
import { randomBytes, scrypt } from 'node:crypto';
import test from 'node:test';
import {
  CURRENT_SCRYPT_PARAMETERS,
  hashPassword,
  PASSWORD_MAX_BYTES,
  passwordHashNeedsRehash,
  verifyPassword
} from './password.js';

function deriveKey(password: string, salt: Buffer, parameters: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 32, { ...parameters, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}

async function legacyCompatibleHash(password: string) {
  const parameters = { N: 1 << 14, r: 8, p: 5 };
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, parameters);
  return [
    'scrypt',
    'v1',
    String(parameters.N),
    String(parameters.r),
    String(parameters.p),
    salt.toString('base64url'),
    key.toString('base64url')
  ].join('$');
}

test('hashPassword gera hash versionado, com salt aleatório, sem expor a senha', async () => {
  const password = 'uma-senha-bem-segura-123';
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.match(first, /^scrypt\$v1\$32768\$8\$3\$/);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(passwordHashNeedsRehash(first), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('senha-incorreta', first), false);
});

test('verifyPassword preserva hashes compatíveis com parâmetros anteriores e sinaliza rehash', async () => {
  const password = 'senha-legada-segura-123';
  const encoded = await legacyCompatibleHash(password);

  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword('outra-senha', encoded), false);
  assert.equal(passwordHashNeedsRehash(encoded), true);
});

test('verifyPassword rejeita hashes malformados ou parâmetros inseguros sem executar custo arbitrário', async () => {
  const salt = randomBytes(16).toString('base64url');
  const key = randomBytes(32).toString('base64url');

  assert.equal(await verifyPassword('senha-segura', 'valor-invalido'), false);
  assert.equal(await verifyPassword('senha-segura', `argon2$v1$32768$8$3$${salt}$${key}`), false);
  assert.equal(await verifyPassword('senha-segura', `scrypt$v1$1073741824$8$1$${salt}$${key}`), false);
  assert.equal(await verifyPassword('senha-segura', `scrypt$v1$32768$7$3$${salt}$${key}`), false);
  assert.equal(passwordHashNeedsRehash('valor-invalido'), true);
});

test('hashPassword limita entrada por bytes UTF-8 e verifyPassword falha fechado', async () => {
  await assert.rejects(() => hashPassword(''), RangeError);
  await assert.rejects(() => hashPassword('a'.repeat(PASSWORD_MAX_BYTES + 1)), RangeError);

  const valid = await hashPassword('senha-valida');
  assert.equal(await verifyPassword('a'.repeat(PASSWORD_MAX_BYTES + 1), valid), false);
});

test('parâmetros correntes permanecem dentro da combinação de custo aprovada', () => {
  assert.deepEqual(CURRENT_SCRYPT_PARAMETERS, {
    N: 1 << 15,
    r: 8,
    p: 3
  });
});
