import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PASSWORD_HASH_ALGORITHM = 'scrypt';
const PASSWORD_HASH_VERSION = 'v1';
const PASSWORD_HASH_PARTS = 7;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY_BYTES = 256 * 1024 * 1024;
const MAX_STORED_HASH_LENGTH = 512;
const MAX_SALT_BYTES = 64;
const MIN_SCRYPT_N = 1 << 13;
const MAX_SCRYPT_N = 1 << 17;
const MAX_SCRYPT_P = 10;
const MAX_SCRYPT_WORK = 1 << 17;

export const PASSWORD_MAX_BYTES = 1024;

export const CURRENT_SCRYPT_PARAMETERS = Object.freeze({
  N: 1 << 15,
  r: 8,
  p: 3
});

type ScryptParameters = {
  N: number;
  r: number;
  p: number;
};

type ParsedPasswordHash = {
  parameters: ScryptParameters;
  salt: Buffer;
  derivedKey: Buffer;
};

function passwordWithinLimits(password: string) {
  const bytes = Buffer.byteLength(password, 'utf8');
  return bytes > 0 && bytes <= PASSWORD_MAX_BYTES;
}

function assertPasswordWithinLimits(password: string) {
  if (!passwordWithinLimits(password)) {
    throw new RangeError(`Senha deve conter entre 1 e ${PASSWORD_MAX_BYTES} bytes em UTF-8.`);
  }
}

function isPositiveIntegerString(value: string) {
  return /^[1-9][0-9]*$/.test(value);
}

function isPowerOfTwo(value: number) {
  return value > 1 && (value & (value - 1)) === 0;
}

function parametersAreSafe(parameters: ScryptParameters) {
  const { N, r, p } = parameters;
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) return false;
  if (!isPowerOfTwo(N) || N < MIN_SCRYPT_N || N > MAX_SCRYPT_N) return false;
  if (r !== 8) return false;
  if (p < 1 || p > MAX_SCRYPT_P) return false;
  if (N * p > MAX_SCRYPT_WORK) return false;
  return 128 * N * r < SCRYPT_MAX_MEMORY_BYTES;
}

function decodeBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, 'base64url');
    if (decoded.toString('base64url') !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

function parsePasswordHash(encoded: string): ParsedPasswordHash | null {
  if (!encoded || encoded.length > MAX_STORED_HASH_LENGTH) return null;

  const parts = encoded.split('$');
  if (parts.length !== PASSWORD_HASH_PARTS) return null;

  const [algorithm, version, nValue, rValue, pValue, saltValue, keyValue] = parts;
  if (algorithm !== PASSWORD_HASH_ALGORITHM || version !== PASSWORD_HASH_VERSION) return null;
  if (!isPositiveIntegerString(nValue) || !isPositiveIntegerString(rValue) || !isPositiveIntegerString(pValue)) {
    return null;
  }

  const parameters = {
    N: Number(nValue),
    r: Number(rValue),
    p: Number(pValue)
  };
  if (!parametersAreSafe(parameters)) return null;

  const salt = decodeBase64Url(saltValue);
  const derivedKey = decodeBase64Url(keyValue);
  if (!salt || salt.length < SALT_BYTES || salt.length > MAX_SALT_BYTES) return null;
  if (!derivedKey || derivedKey.length !== DERIVED_KEY_BYTES) return null;

  return { parameters, salt, derivedKey };
}

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      DERIVED_KEY_BYTES,
      {
        N: parameters.N,
        r: parameters.r,
        p: parameters.p,
        maxmem: SCRYPT_MAX_MEMORY_BYTES
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      }
    );
  });
}

function serializePasswordHash(parameters: ScryptParameters, salt: Buffer, derivedKey: Buffer) {
  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_VERSION,
    String(parameters.N),
    String(parameters.r),
    String(parameters.p),
    salt.toString('base64url'),
    derivedKey.toString('base64url')
  ].join('$');
}

export async function hashPassword(password: string) {
  assertPasswordWithinLimits(password);
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = await deriveKey(password, salt, CURRENT_SCRYPT_PARAMETERS);
  return serializePasswordHash(CURRENT_SCRYPT_PARAMETERS, salt, derivedKey);
}

export async function verifyPassword(password: string, encodedHash: string) {
  if (!passwordWithinLimits(password)) return false;
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;

  try {
    const candidate = await deriveKey(password, parsed.salt, parsed.parameters);
    return candidate.length === parsed.derivedKey.length && timingSafeEqual(candidate, parsed.derivedKey);
  } catch {
    return false;
  }
}

export function passwordHashNeedsRehash(encodedHash: string) {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return true;
  return (
    parsed.parameters.N !== CURRENT_SCRYPT_PARAMETERS.N
    || parsed.parameters.r !== CURRENT_SCRYPT_PARAMETERS.r
    || parsed.parameters.p !== CURRENT_SCRYPT_PARAMETERS.p
    || parsed.salt.length !== SALT_BYTES
  );
}
