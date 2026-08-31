import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { databaseIsOpenByAnotherProcess } from './backup-process-guard.js';
import {
  BackupService,
  RestoreRollbackError,
  backupServiceErrorMessage
} from './backup-service.js';

const rootEnvPath = fileURLToPath(new URL('../../../.env', import.meta.url));
const defaultDatabasePath = fileURLToPath(new URL('../../../data/home-music.db', import.meta.url));
const defaultBackupRoot = fileURLToPath(new URL('../../../backups', import.meta.url));
config({ path: rootEnvPath });

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function usage() {
  console.error('Uso:');
  console.error('  npm run backup:create -- [--output <diretorio>]');
  console.error('  npm run backup:verify -- --artifact <diretorio.backup>');
  console.error('  npm run backup:restore -- --artifact <diretorio.backup> --confirm-service-stopped');
}

function homeMusicServiceIsActive() {
  const result = spawnSync(
    'systemctl',
    ['is-active', '--quiet', 'home-music.service'],
    { stdio: 'ignore' }
  );
  return !result.error && result.status === 0;
}

async function restoreOfflineBlocker(databasePath: string) {
  if (homeMusicServiceIsActive()) {
    return 'home-music.service ainda está ativo. Execute sudo systemctl stop home-music antes do restore.';
  }
  if (await databaseIsOpenByAnotherProcess(databasePath)) {
    return 'O SQLite ainda está aberto por outro processo. Pare npm run dev/npm start ou qualquer processo que esteja usando o banco antes do restore.';
  }
  return null;
}

const command = process.argv[2];
const databasePath = process.env.HOME_MUSIC_DATABASE_PATH || defaultDatabasePath;
const backups = new BackupService({
  databasePath,
  defaultOutputRoot: defaultBackupRoot,
  env: process.env,
  restoreOfflineBlocker
});

try {
  if (command === 'create') {
    const result = await backups.create(argumentValue('--output'));
    console.log(`Backup criado e validado: ${result.artifactPath}`);
    console.log(`SQLite: ${result.manifest.database.bytes} bytes · schema ${result.manifest.database.schemaVersion}`);
    console.log(`SHA-256: ${result.manifest.database.sha256}`);
    console.log('Credenciais e segredos não são incluídos no manifesto.');
  } else if (command === 'verify') {
    const artifact = argumentValue('--artifact');
    if (!artifact) {
      usage();
      process.exitCode = 2;
    } else {
      const result = await backups.verify(artifact);
      console.log(`Backup válido: ${result.artifactPath}`);
      console.log(`SQLite íntegro · schema ${result.manifest.database.schemaVersion} · ${result.manifest.database.bytes} bytes`);
      console.log(`SHA-256: ${result.manifest.database.sha256}`);
    }
  } else if (command === 'restore') {
    const artifact = argumentValue('--artifact');
    const confirmedStopped = process.argv.includes('--confirm-service-stopped');
    if (!artifact || !confirmedStopped) {
      usage();
      if (!confirmedStopped) {
        console.error('O restore exige confirmação explícita de que o servidor está parado.');
      }
      process.exitCode = 2;
    } else {
      const result = await backups.restore(artifact, {
        onVerified: verified => {
          console.log(`Artefato validado antes do restore: ${verified.manifest.database.sha256}`);
        }
      });
      if (result.blocked) {
        console.error(result.blocked);
        process.exitCode = 1;
      } else {
        console.log(`Restore concluído com rollback protegido: ${result.restored.databasePath}`);
        console.log('O .env não foi sobrescrito automaticamente. Revise manifest.json para reaplicar apenas configurações operacionais necessárias.');
        console.log('Inicie o serviço e valide /ready + login antes de remover ou arquivar o backup.');
      }
    }
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`Falha no ${command || 'comando'}: ${backupServiceErrorMessage(error)}`);
  if (error instanceof RestoreRollbackError) {
    console.error('Rollback automático também falhou. Não inicie o serviço antes de preservar data/ e inspecionar o estado manualmente.');
  }
  process.exitCode = 1;
}
