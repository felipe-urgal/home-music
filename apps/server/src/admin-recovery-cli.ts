import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { recoverLocalAdmin } from './admin-recovery.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
config({ path: rootEnvPath });

function usage() {
  console.error(
    'Uso: npm run admin:recover -- --username <usuario> --confirm-service-stopped'
  );
}

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function homeMusicServiceIsActive() {
  const result = spawnSync(
    'systemctl',
    ['is-active', '--quiet', 'home-music.service'],
    { stdio: 'ignore' }
  );
  return !result.error && result.status === 0;
}

const username = argumentValue('--username');
const confirmedStopped = process.argv.includes('--confirm-service-stopped');
const databasePath = process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;

if (!username || !confirmedStopped) {
  usage();
  if (!confirmedStopped) {
    console.error('Pare o serviço Home Music antes da recuperação para invalidar todas as sessões em memória.');
  }
  process.exitCode = 2;
} else if (homeMusicServiceIsActive()) {
  console.error('home-music.service ainda está ativo. Execute sudo systemctl stop home-music antes da recuperação.');
  process.exitCode = 1;
} else if (!existsSync(databasePath)) {
  console.error(`Banco não encontrado em ${databasePath}. Nenhuma alteração foi feita.`);
  process.exitCode = 1;
} else {
  try {
    const result = await recoverLocalAdmin(databasePath, username);
    if (!result.ok) {
      const message = result.error === 'invalid-username'
        ? 'Username inválido.'
        : result.error === 'database-not-initialized'
          ? 'O banco ainda não possui a tabela de usuários. Faça o bootstrap inicial primeiro.'
          : 'Usuário não encontrado. A recuperação local não cria contas novas.';
      console.error(message);
      process.exitCode = 1;
    } else {
      console.log(`Administrador recuperado: ${result.username}`);
      console.log(`Senha temporária: ${result.temporaryPassword}`);
      console.log('A conta foi reativada/promovida a admin e exigirá troca de senha no próximo login.');
      console.log('Inicie o serviço novamente e use a senha temporária acima uma única vez.');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido';
    console.error(`Falha ao recuperar administrador: ${message}`);
    process.exitCode = 1;
  }
}
