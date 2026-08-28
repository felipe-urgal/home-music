import { readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';

export async function databaseIsOpenByAnotherProcess(databasePath: string, ownPid = process.pid) {
  if (process.platform !== 'linux') return false;
  const resolvedDatabasePath = await realpath(databasePath).catch(() => path.resolve(databasePath));
  const procEntries = await readdir('/proc', { withFileTypes: true }).catch(() => []);
  for (const entry of procEntries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name) || Number(entry.name) === ownPid) continue;
    const descriptors = await readdir(`/proc/${entry.name}/fd`).catch(() => []);
    for (const descriptor of descriptors) {
      const target = await readlink(`/proc/${entry.name}/fd/${descriptor}`).catch(() => null);
      if (!target) continue;
      const normalized = target.replace(/ \(deleted\)$/, '');
      if (
        normalized === resolvedDatabasePath ||
        normalized === `${resolvedDatabasePath}-wal` ||
        normalized === `${resolvedDatabasePath}-shm`
      ) {
        return true;
      }
    }
  }
  return false;
}
