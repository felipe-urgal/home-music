import type { AdminScanTrigger, ScanResponse } from '@home-music/shared';
import type { AdminOperationHistoryStore } from './admin-operation-history.js';

type HistoryFailureHandler = (error: unknown) => void;

export async function runScanWithHistory(
  history: Pick<AdminOperationHistoryStore, 'startScan' | 'completeScan' | 'failScan'>,
  trigger: AdminScanTrigger,
  operation: () => Promise<ScanResponse>,
  onHistoryFailure: HistoryFailureHandler = () => undefined
) {
  let operationId: string | null = null;
  try {
    operationId = history.startScan(trigger);
  } catch (error) {
    onHistoryFailure(error);
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
    return result;
  } catch (error) {
    if (operationId) {
      try {
        history.failScan(operationId, error);
      } catch (historyError) {
        onHistoryFailure(historyError);
      }
    }
    throw error;
  }
}
