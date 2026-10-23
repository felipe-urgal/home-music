import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
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

function homeMusicServiceState(): 'active' | 'inactive' | 'unknown' {
  // An unresponsive service manager must not hang the restore or pass as stopped.
  const result = spawnSync(
    'systemctl',
    ['is-active', '--quiet', 'home-music.service'],
    { stdio: 'ignore', timeout: 2_000 }
  );
  if (result.error) {
    // On hosts without systemctl, the operator still provides explicit confirmation.
    return (result.error as NodeJS.ErrnoException).code === 'ENOENT' ? 'inactive' : 'unknown';
  }
  // is-active uses 0 for active and 3 for explicitly inactive/failed units.
  // Other exit codes may indicate missing units or service-manager errors.
  if (result.status === 0) return 'active';
  if (result.status === 3) return 'inactive';
  return 'unknown';
}

async function restoreOfflineBlocker(databasePath: string) {
  const serviceState = homeMusicServiceState();
  if (serviceState === 'active') {
    return 'home-music.service ainda está ativo. Execute sudo systemctl stop home-music antes do restore.';
  }
  if (serviceState === 'unknown') {
    return 'Não foi possível verificar o estado de home-music.service. Confira o systemctl e confirme que o serviço está parado antes do restore.';
  }
  try {
    if (await databaseIsOpenByAnotherProcess(databasePath)) {
      return 'O SQLite ainda está aberto por outro processo. Pare npm run dev/npm start ou qualquer processo que esteja usando o banco antes do restore.';
    }
  } catch {
    // No unverified restore when the Linux process inventory is unavailable.
    return 'Não foi possível inspecionar os processos que usam o SQLite. Verifique o acesso a /proc e mantenha o serviço parado antes do restore.';
  }
  return null;
}

const command = process.argv[2];
const operationStartedAt = performance.now();
let operationStatus: 'success' | 'blocked' | 'failed' = 'failed';
let operationSchemaVersion: number | null = null;
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
    operationSchemaVersion = result.manifest.database.schemaVersion;
    operationStatus = 'success';
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
      operationSchemaVersion = result.manifest.database.schemaVersion;
      operationStatus = 'success';
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
          operationSchemaVersion = verified.manifest.database.schemaVersion;
          console.log(`Artefato validado antes do restore: ${verified.manifest.database.sha256}`);
        }
      });
      if (result.blocked !== null) {
        operationStatus = 'blocked';
        console.error(result.blocked);
        process.exitCode = 1;
      } else {
        operationStatus = 'success';
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
} finally {
  // Metrics have a fixed set of fields; never include paths, hashes or credentials.
  if (command === 'create' || command === 'verify' || command === 'restore') {
    const durationMs = Math.max(0, Math.round(performance.now() - operationStartedAt));
    console.error(
      `Backup operation: operation=${command} status=${operationStatus} schemaVersion=${operationSchemaVersion ?? 'unknown'} durationMs=${durationMs}`
    );
  }
}
