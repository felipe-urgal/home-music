import type { AdminScanTrigger, ScanResponse } from '@home-music/shared';
import type { AdminOperationHistoryStore } from './admin-operation-history.js';
import type { LongJobObservability, LongJobRun } from './long-job-observability.js';

type HistoryFailureHandler = (error: unknown) => void;

export async function runScanWithHistory(
  history: Pick<AdminOperationHistoryStore, 'startScan' | 'completeScan' | 'failScan'>,
  trigger: AdminScanTrigger,
  operation: () => Promise<ScanResponse>,
  onHistoryFailure: HistoryFailureHandler = () => undefined,
  observability?: LongJobObservability
) {
  let operationId: string | null = null;
  try {
    operationId = history.startScan(trigger);
  } catch (error) {
    onHistoryFailure(error);
  }

  let observedRun: LongJobRun | null = null;
  if (observability) {
    observedRun = observability.start({
      jobType: 'library.scan',
      jobId: operationId,
      operationId
    });
  }

  try {
    const result = await operation();
    if (operationId) {
      try {
        history.completeScan(operationId, result);
      } catch (error) {
        onHistoryFailure(error);
      }
    }
    if (observedRun) {
      observability?.complete(observedRun, {
        tracks: result.tracks,
        added: result.added,
        updated: result.updated,
        removed: result.removed,
        unchanged: result.unchanged
      });
    }
    return result;
  } catch (error) {
    if (operationId) {
      try {
        history.failScan(operationId, error);
      } catch (historyError) {
        onHistoryFailure(historyError);
      }
    }
    if (observedRun) observability?.fail(observedRun, error);
    throw error;
  }
}
