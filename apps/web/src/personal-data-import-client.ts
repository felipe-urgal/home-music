import type {
  PersonalDataImportApplyResponseV1,
  PersonalDataImportPreviewReferenceCounts,
  PersonalDataImportPreviewResponseV1
} from '@home-music/shared/personal-data';
import { PERSONAL_DATA_IMPORT_LIMITS } from '@home-music/shared/personal-data';
import { apiFetch } from './api-client';

export class PersonalDataImportClientError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    readonly code: string | null = null
  ) {
    super(message);
    this.name = 'PersonalDataImportClientError';
  }
}

async function responseError(response: Response) {
  try {
    const body = await response.json() as { error?: unknown; code?: unknown };
    return new PersonalDataImportClientError(
      typeof body.error === 'string' && body.error.trim()
        ? body.error
        : `Falha HTTP ${response.status}`,
      response.status,
      typeof body.code === 'string' ? body.code : null
    );
  } catch {
    return new PersonalDataImportClientError(`Falha HTTP ${response.status}`, response.status);
  }
}

function isCount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isReferenceCounts(value: unknown): value is PersonalDataImportPreviewReferenceCounts {
  if (!value || typeof value !== 'object') return false;
  const counts = value as Partial<PersonalDataImportPreviewReferenceCounts>;
  return isCount(counts.total)
    && isCount(counts.found)
    && isCount(counts.missing)
    && isCount(counts.ambiguous)
    && isCount(counts.conflict);
}

function isPreviewResponse(value: unknown): value is PersonalDataImportPreviewResponseV1 {
  if (!value || typeof value !== 'object') return false;
  const preview = value as Partial<PersonalDataImportPreviewResponseV1>;
  return preview.format === 'home-music-personal-data'
    && preview.version === 1
    && typeof preview.exportedAt === 'string'
    && isReferenceCounts(preview.references)
    && Array.isArray(preview.issues)
    && typeof preview.issuesTruncated === 'boolean'
    && typeof preview.confirmationToken === 'string'
    && /^[a-f0-9]{64}$/.test(preview.confirmationToken);
}

function isApplyResponse(value: unknown): value is PersonalDataImportApplyResponseV1 {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<PersonalDataImportApplyResponseV1>;
  const summary = response.summary;
  return Boolean(response.preview)
    && Boolean(summary)
    && isCount(summary?.applied)
    && isCount(summary?.ignored)
    && isCount(summary?.missing)
    && isCount(summary?.ambiguous)
    && isCount(summary?.conflict)
    && isCount(summary?.failed)
    && Boolean(summary?.domains);
}

export async function readPersonalDataImportFile(file: File) {
  if (!file.name.toLocaleLowerCase('pt-BR').endsWith('.json')) {
    throw new PersonalDataImportClientError('Selecione um arquivo JSON exportado pelo Home Music.');
  }
  if (file.size > PERSONAL_DATA_IMPORT_LIMITS.maxBytes) {
    throw new PersonalDataImportClientError('O arquivo excede o limite de 5 MiB para importação.');
  }

  const text = await file.text();
  if (!text.trim()) {
    throw new PersonalDataImportClientError('O arquivo selecionado está vazio.');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PersonalDataImportClientError('O arquivo selecionado não contém JSON válido.');
  }
}

export async function previewPersonalDataImport(bundle: unknown) {
  const response = await apiFetch('/api/account/personal-data/import/preview', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify(bundle)
  });
  if (!response.ok) throw await responseError(response);

  const body = await response.json() as unknown;
  if (!isPreviewResponse(body)) {
    throw new PersonalDataImportClientError('Resposta inválida ao analisar os dados pessoais.');
  }
  return body;
}

export async function applyPersonalDataImport(
  bundle: unknown,
  confirmationToken: string
) {
  const response = await apiFetch('/api/account/personal-data/import/apply', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({
      bundle,
      confirmationToken,
      confirmed: true
    })
  });
  if (!response.ok) throw await responseError(response);

  const body = await response.json() as unknown;
  if (!isApplyResponse(body)) {
    throw new PersonalDataImportClientError('Resposta inválida ao aplicar os dados pessoais.');
  }
  return body;
}
