import type { AccountOpenSubsonicKey } from './account-client';

export function reconcileOpenSubsonicKeySnapshot(
  current: readonly AccountOpenSubsonicKey[],
  snapshot: readonly AccountOpenSubsonicKey[],
  revokedIds: ReadonlySet<string>
) {
  const merged = new Map<string, AccountOpenSubsonicKey>();

  for (const key of current) {
    if (!revokedIds.has(key.id)) merged.set(key.id, key);
  }
  for (const key of snapshot) {
    if (!revokedIds.has(key.id) && !merged.has(key.id)) merged.set(key.id, key);
  }

  return [...merged.values()];
}
