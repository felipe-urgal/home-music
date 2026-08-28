import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

export const BACKUP_FORMAT_VERSION = 1;
export const MAX_SUPPORTED_SCHEMA_VERSION = 10;
export const BACKUP_DATABASE_FILE = 'home-music.db';
export const BACKUP_MANIFEST_FILE = 'manifest.json';

const SAFE_CONFIG_KEYS = [
  'MUSIC_DIR',
  'HOME_MUSIC_RESCAN_INTERVAL_SECONDS',
  'HOME_MUSIC_FFMPEG_PATH',
  'HOME_MUSIC_TRANSCODE_CACHE_MB',
  'HOME_MUSIC_COOKIE_SECURE',
  'HOME_MUSIC_TRUST_TAILSCALE_PROXY',
  'PORT',
  'HOST',
  'PRODUCTION_HOST'
] as const;

const SAFE_CONFIG_KEY_SET = new Set<string>(SAFE_CONFIG_KEYS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

type Row = Record<string, unknown>;

export type BackupSafeConfig = Partial<Record<(typeof SAFE_CONFIG_KEYS)[number], string>>;

export type BackupManifest = {
  formatVersion: 1;
  createdAt: string;
  database: {
    file: typeof BACKUP_DATABASE_FILE;
    bytes: number;
    sha256: string;
    schemaVersion: number;
  };
  config: BackupSafeConfig;
};

type CreateBackupOptions = {
  databasePath: string;
  outputRoot: string;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  createId?: () => string;
};

type RestoreBackupOptions = {
  afterReplace?: (databasePath: string) => Promise<void> | void;
};

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

export class RestoreRollbackError extends Error {
  readonly restoreError: unknown;
  readonly rollbackError: unknown;

  constructor(restoreError: unknown, rollbackError: unknown) {
    super('O restore falhou e o rollback automático também falhou. Preserve o artefato e o diretório data antes de qualquer nova tentativa.');
    this.name = 'RestoreRollbackError';
    this.restoreError = restoreError;
    this.rollbackError = rollbackError;
  }
}

async function assertRegularFile(filePath: string, label: string) {
  let info;
  try {
    info = await lstat(filePath);
  } catch {
    throw new BackupValidationError(`${label} não encontrado.`);
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BackupValidationError(`${label} precisa ser um arquivo regular, sem symlink.`);
  }
  return info;
}

async function ensureRegularDirectory(directoryPath: string, label: string) {
  await mkdir(directoryPath, { recursive: true, mode: 0o700 });
  const info = await lstat(directoryPath);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new BackupValidationError(`${label} precisa ser um diretório real, sem symlink.`);
  }
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

function firstValue(row: Row | undefined) {
  if (!row) return undefined;
  return Object.values(row)[0];
}

function databaseInfo(databasePath: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  try {
    const integrityRows = db.prepare('PRAGMA integrity_check;').all() as Row[];
    const integrityOk = integrityRows.length === 1 && firstValue(integrityRows[0]) === 'ok';
    if (!integrityOk) {
      throw new BackupValidationError('O SQLite do backup falhou no PRAGMA integrity_check.');
    }
    const schemaRow = db.prepare('PRAGMA user_version;').get() as Row | undefined;
    const schemaVersion = Number(firstValue(schemaRow));
    if (!Number.isInteger(schemaVersion) || schemaVersion < 0) {
      throw new BackupValidationError('O SQLite do backup possui user_version inválido.');
    }
    return { schemaVersion };
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    const message = error instanceof Error ? error.message : 'erro desconhecido';
    throw new BackupValidationError(`Não foi possível validar o SQLite do backup: ${message}`);
  } finally {
    db.close();
  }
}

function safeConfigSnapshot(env: NodeJS.ProcessEnv): BackupSafeConfig {
  const result: BackupSafeConfig = {};
  for (const key of SAFE_CONFIG_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.length > 0) result[key] = value;
  }
  return result;
}

function parseManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackupValidationError('Manifesto do backup inválido.');
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupValidationError('Versão do formato de backup não suportada.');
  }
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new BackupValidationError('Data de criação do backup inválida.');
  }
  if (!manifest.database || typeof manifest.database !== 'object' || Array.isArray(manifest.database)) {
    throw new BackupValidationError('Metadados do banco ausentes no manifesto.');
  }
  const database = manifest.database as Record<string, unknown>;
  if (database.file !== BACKUP_DATABASE_FILE) {
    throw new BackupValidationError('Nome do arquivo SQLite do backup inválido.');
  }
  if (!Number.isSafeInteger(database.bytes) || Number(database.bytes) <= 0) {
    throw new BackupValidationError('Tamanho do SQLite no manifesto é inválido.');
  }
  if (typeof database.sha256 !== 'string' || !SHA256_PATTERN.test(database.sha256)) {
    throw new BackupValidationError('SHA-256 do SQLite no manifesto é inválido.');
  }
  if (!Number.isInteger(database.schemaVersion) || Number(database.schemaVersion) < 0) {
    throw new BackupValidationError('Versão do schema no manifesto é inválida.');
  }
  if (Number(database.schemaVersion) > MAX_SUPPORTED_SCHEMA_VERSION) {
    throw new BackupValidationError(
      `O backup usa schema ${database.schemaVersion}, mais novo que o suportado (${MAX_SUPPORTED_SCHEMA_VERSION}). Atualize o Home Music antes do restore.`
    );
  }

  const config = manifest.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new BackupValidationError('Snapshot de configuração do backup inválido.');
  }
  const safeConfig: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(config)) {
    if (!SAFE_CONFIG_KEY_SET.has(key) || typeof rawValue !== 'string') {
      throw new BackupValidationError(`Configuração não permitida no manifesto: ${key}.`);
    }
    safeConfig[key] = rawValue;
  }

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: manifest.createdAt,
    database: {
      file: BACKUP_DATABASE_FILE,
      bytes: Number(database.bytes),
      sha256: database.sha256,
      schemaVersion: Number(database.schemaVersion)
    },
    config: safeConfig as BackupSafeConfig
  };
}

export async function verifyBackupArtifact(artifactPath: string) {
  const artifactInfo = await lstat(artifactPath).catch(() => null);
  if (!artifactInfo || !artifactInfo.isDirectory() || artifactInfo.isSymbolicLink()) {
    throw new BackupValidationError('O artefato de backup precisa ser um diretório regular, sem symlink.');
  }

  const manifestPath = path.join(artifactPath, BACKUP_MANIFEST_FILE);
  const databasePath = path.join(artifactPath, BACKUP_DATABASE_FILE);
  await assertRegularFile(manifestPath, 'Manifesto do backup');
  const databaseStat = await assertRegularFile(databasePath, 'SQLite do backup');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new BackupValidationError('Manifesto do backup não contém JSON válido.');
  }
  const manifest = parseManifest(parsed);

  if (databaseStat.size !== manifest.database.bytes) {
    throw new BackupValidationError('Tamanho do SQLite diverge do manifesto.');
  }
  const sha256 = await sha256File(databasePath);
  if (sha256 !== manifest.database.sha256) {
    throw new BackupValidationError('SHA-256 do SQLite diverge do manifesto. O artefato pode estar corrompido ou adulterado.');
  }
  const info = databaseInfo(databasePath);
  if (info.schemaVersion !== manifest.database.schemaVersion) {
    throw new BackupValidationError('user_version do SQLite diverge do manifesto.');
  }

  return { artifactPath, databasePath, manifest };
}

function artifactName(now: Date, id: string) {
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return `home-music-${timestamp}-${id.slice(0, 8)}.backup`;
}

function safeIdentifier(value: string) {
  const safe = value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return safe || randomUUID();
}

export async function createBackupArtifact(options: CreateBackupOptions) {
  await assertRegularFile(options.databasePath, 'Banco principal');
  await ensureRegularDirectory(options.outputRoot, 'Diretório de backup');

  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const id = safeIdentifier(createId());
  const finalPath = path.join(options.outputRoot, artifactName(now(), id));
  const partialPath = path.join(options.outputRoot, `.home-music-${id}.partial`);
  const snapshotPath = path.join(partialPath, BACKUP_DATABASE_FILE);
  const manifestPath = path.join(partialPath, BACKUP_MANIFEST_FILE);

  await rm(partialPath, { recursive: true, force: true });
  await mkdir(partialPath, { mode: 0o700 });

  try {
    const sourceDb = new DatabaseSync(options.databasePath, { timeout: 5_000 });
    try {
      await backup(sourceDb, snapshotPath, { rate: 100 });
    } finally {
      sourceDb.close();
    }

    await chmod(snapshotPath, 0o600);
    const info = databaseInfo(snapshotPath);
    if (info.schemaVersion > MAX_SUPPORTED_SCHEMA_VERSION) {
      throw new BackupValidationError(
        `O banco principal usa schema ${info.schemaVersion}, mais novo que este Home Music suporta (${MAX_SUPPORTED_SCHEMA_VERSION}).`
      );
    }
    const snapshotStat = await stat(snapshotPath);
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: now().toISOString(),
      database: {
        file: BACKUP_DATABASE_FILE,
        bytes: snapshotStat.size,
        sha256: await sha256File(snapshotPath),
        schemaVersion: info.schemaVersion
      },
      config: safeConfigSnapshot(options.env ?? process.env)
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await verifyBackupArtifact(partialPath);
    await rename(partialPath, finalPath);
    return { artifactPath: finalPath, manifest };
  } catch (error) {
    await rm(partialPath, { recursive: true, force: true });
    throw error;
  }
}

async function createRollbackSnapshot(databasePath: string, rollbackPath: string) {
  const currentDb = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    await backup(currentDb, rollbackPath, { rate: 100 });
  } finally {
    currentDb.close();
  }
  await chmod(rollbackPath, 0o600);
  databaseInfo(rollbackPath);
}

export async function restoreBackupArtifact(
  artifactPath: string,
  databasePath: string,
  options: RestoreBackupOptions = {}
) {
  const verified = await verifyBackupArtifact(artifactPath);
  const databaseDir = path.dirname(databasePath);
  await ensureRegularDirectory(databaseDir, 'Diretório de dados');

  const id = randomUUID();
  const installPath = path.join(databaseDir, `.home-music-restore-${id}.db`);
  const rollbackPath = path.join(databaseDir, `.home-music-rollback-${id}.db`);
  let rollbackReady = false;
  let replacementStarted = false;

  const currentInfo = await lstat(databasePath).catch(() => null);
  if (currentInfo && (!currentInfo.isFile() || currentInfo.isSymbolicLink())) {
    throw new BackupValidationError('O banco atual precisa ser um arquivo regular, sem symlink.');
  }

  try {
    await copyFile(verified.databasePath, installPath, 0);
    await chmod(installPath, 0o600);
    databaseInfo(installPath);

    if (currentInfo) {
      await createRollbackSnapshot(databasePath, rollbackPath);
      rollbackReady = true;
    }

    replacementStarted = true;
    await rm(`${databasePath}-wal`, { force: true });
    await rm(`${databasePath}-shm`, { force: true });
    await rename(installPath, databasePath);
    await chmod(databasePath, 0o600);
    databaseInfo(databasePath);
    await options.afterReplace?.(databasePath);

    if (rollbackReady) {
      await rm(rollbackPath, { force: true }).catch(() => undefined);
      rollbackReady = false;
    }
    return {
      databasePath,
      manifest: verified.manifest
    };
  } catch (restoreError) {
    if (replacementStarted && rollbackReady) {
      try {
        await rm(`${databasePath}-wal`, { force: true });
        await rm(`${databasePath}-shm`, { force: true });
        await rename(rollbackPath, databasePath);
        await chmod(databasePath, 0o600);
        databaseInfo(databasePath);
        rollbackReady = false;
      } catch (rollbackError) {
        throw new RestoreRollbackError(restoreError, rollbackError);
      }
    }
    throw restoreError;
  } finally {
    await rm(installPath, { force: true });
    if (rollbackReady && !replacementStarted) await rm(rollbackPath, { force: true });
  }
}
