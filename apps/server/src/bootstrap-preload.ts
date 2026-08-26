import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));

config({ path: rootEnvPath });

const databasePath = process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
const username = process.env.HOME_MUSIC_USER || '';
const password = process.env.HOME_MUSIC_PASSWORD || '';

try {
  const result = await bootstrapInitialAdmin({
    databasePath,
    username,
    password
  });

  if (result.status === 'created') {
    console.info('[home-music] Primeiro administrador persistido com sucesso no SQLite.');
    console.info('[home-music] HOME_MUSIC_USER/HOME_MUSIC_PASSWORD agora podem ser removidos do .env.');
  } else if (result.status === 'credentials-not-bootstrapable') {
    console.warn(
      `[home-music] Bootstrap do primeiro administrador não executado: credencial inicial inválida (${result.reason}).`
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  console.error(`[home-music] Falha no bootstrap do primeiro administrador (${message}).`);
}
