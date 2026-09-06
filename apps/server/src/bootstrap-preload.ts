import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import { resolveBootstrapEnvFile } from './bootstrap-preload-env.js';

const {
  isProduction,
  envFilename,
  envPath,
  source: envSource
} = resolveBootstrapEnvFile();
const defaultDatabasePath = fileURLToPath(new URL(
  isProduction ? '../../../data/home-music.db' : '../../../data/development/home-music.db',
  import.meta.url
));

const envResult = config({ path: envPath, override: !isProduction });
if (envResult.error) {
  const instruction = envSource === 'configured'
    ? 'Verifique HOME_MUSIC_ENV_FILE antes de iniciar a aplicação.'
    : isProduction
      ? 'Configure o .env antes de iniciar a produção.'
      : 'Copie .env.development.example para .env.development antes de iniciar o DEV.';
  const envDisplayName = envSource === 'configured' ? envPath : envFilename;
  throw new Error(`Arquivo ${envDisplayName} não encontrado. ${instruction}`);
}

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
    console.info(`[home-music] HOME_MUSIC_USER/HOME_MUSIC_PASSWORD agora podem ser removidos do ${envFilename}.`);
  } else if (result.status === 'credentials-not-bootstrapable') {
    console.warn(
      `[home-music] Bootstrap do primeiro administrador não executado: credencial inicial inválida (${result.reason}).`
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  console.error(`[home-music] Falha no bootstrap do primeiro administrador (${message}).`);
}
