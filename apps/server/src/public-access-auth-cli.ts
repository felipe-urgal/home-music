import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { verifyPublicAccessAdmin } from './public-access-auth.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
config({ path: rootEnvPath });

const minimumCharacters = Number(process.argv[2] || 20);
const databasePath = process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;

try {
  const input = await readFile(0);
  const [usernameBuffer, passwordBuffer] = input.toString('utf8').split('\0');
  const username = usernameBuffer ?? '';
  const password = passwordBuffer ?? '';
  const valid = await verifyPublicAccessAdmin(
    databasePath,
    username,
    password,
    Number.isSafeInteger(minimumCharacters) && minimumCharacters >= 12 ? minimumCharacters : 20
  );
  process.exitCode = valid ? 0 : 1;
} catch {
  process.exitCode = 1;
}
