export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency deve ser um inteiro maior ou igual a 1.');
  }
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;
  let failed = false;
  let firstError: unknown;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;

      try {
        results[index] = await operation(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
        return;
      }
    }
  });

  await Promise.all(workers);
  if (failed) throw firstError;
  return results;
}
