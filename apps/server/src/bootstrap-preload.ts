import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { bootstrapInitialAdmin } from './bootstrap-admin.js';
import {
  resolveLegacyAuthBinding,
  writeLegacyAuthBindingToEnvironment
} from './legacy-auth-binding.js';

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
  } else if (result.status === 'credentials-not-bootstrapable') {
    console.warn(
      `[home-music] Bootstrap do primeiro administrador não executado: credencial legada inválida (${result.reason}).`
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  console.error(`[home-music] Falha no bootstrap do primeiro administrador (${message}).`);
}

try {
  const binding = resolveLegacyAuthBinding(databasePath, username);
  writeLegacyAuthBindingToEnvironment(binding);

  if (binding.status === 'bound') {
    console.info('[home-music] Login legado vinculado ao usuário persistido para criação de sessão identificada.');
  } else if (binding.status === 'legacy-uninitialized') {
    console.warn(
      '[home-music] Tabela users ainda vazia; sessão legada sem userId permanece disponível somente como fallback de transição.'
    );
  } else {
    console.error(
      '[home-music] Credencial legada não corresponde a um usuário ativo persistido; autenticação bloqueada para evitar bypass do modelo de usuários.'
    );
  }
} catch (error) {
  writeLegacyAuthBindingToEnvironment({ status: 'blocked' });
  const message = error instanceof Error ? error.message : 'erro desconhecido';
  console.error(
    `[home-music] Não foi possível validar o vínculo do login legado com o SQLite (${message}); autenticação bloqueada por segurança.`
  );
}
