export type AdminBatchFailure<T> = {
  item: T;
  error: string;
};

export type AdminBatchResult<T> = {
  succeeded: T[];
  failed: Array<AdminBatchFailure<T>>;
};

type AdminBatchOptions = {
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

export async function runAdminBatch<T>(
  items: readonly T[],
  operation: (item: T) => Promise<unknown>,
  options: AdminBatchOptions = {}
): Promise<AdminBatchResult<T>> {
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concorrência do lote precisa ser um inteiro positivo.');
  }

  const succeeded: T[] = [];
  const failed: Array<AdminBatchFailure<T>> = [];
  if (items.length === 0) return { succeeded, failed };

  let cursor = 0;
  let completed = 0;
  options.onProgress?.(0, items.length);

  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];

      try {
        await operation(item);
        succeeded.push(item);
      } catch (error) {
        failed.push({ item, error: errorMessage(error) });
      } finally {
        completed += 1;
        options.onProgress?.(completed, items.length);
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { succeeded, failed };
}

export function summarizeAdminBatch(
  action: string,
  result: AdminBatchResult<unknown>
) {
  const successCount = result.succeeded.length;
  const failureCount = result.failed.length;
  if (failureCount === 0) {
    return `${action}: ${successCount} ${successCount === 1 ? 'item concluído' : 'itens concluídos'}.`;
  }

  const firstError = result.failed[0]?.error;
  return `${action}: ${successCount} concluído${successCount === 1 ? '' : 's'}, ${failureCount} com falha.${firstError ? ` Primeira falha: ${firstError}` : ''}`;
}
