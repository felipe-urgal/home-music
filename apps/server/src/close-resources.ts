// Release every owner even when an earlier close fails. Preserve single errors as-is;
// report all causes when more than one resource cannot be closed.
export async function closeAll(steps: ReadonlyArray<() => void | Promise<void>>): Promise<void> {
  const failures: unknown[] = [];
  for (const close of steps) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Falha ao encerrar múltiplos recursos do Home Music.');
  }
}

 // Close composite owners without changing synchronous close() contracts.
export function closeAllSync(steps: ReadonlyArray<() => void>): void {
  const failures: unknown[] = [];
  for (const close of steps) {
    try {
      close();
    } catch (error) {
      failures.push(error);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Falha ao encerrar múltiplos recursos do Home Music.');
  }
}
