import { createHash } from 'node:crypto';
import type { PersonalDataImportPlan } from './personal-data-import-plan.js';

const CONFIRMATION_VERSION = 1;

export function personalDataImportConfirmationToken(
  userId: string,
  plan: PersonalDataImportPlan
) {
  if (!userId || userId.length > 128) {
    throw new RangeError('Identidade do import pessoal inválida.');
  }

  const payload = JSON.stringify({
    confirmationVersion: CONFIRMATION_VERSION,
    userId,
    bundle: plan.bundle,
    references: plan.references.map(item => ({
      field: item.field,
      location: item.location,
      status: item.match.status,
      trackId: item.match.trackId,
      strategy: item.match.strategy,
      reason: item.match.reason,
      candidateTrackIds: item.match.candidateTrackIds
    }))
  });

  return createHash('sha256').update(payload).digest('hex');
}
