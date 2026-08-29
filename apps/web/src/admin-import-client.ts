import type {
  AdminImportJobsResponse,
  ImportJob,
  ImportMediaDecision,
  ImportOutputProfile
} from '@home-music/shared';
import { apiFetch, AUTH_REQUIRED_EVENT } from './api-client';

export type AdminImportUploadConfig = {
  maxBytes: number;
  acceptedExtensions: string[];
};

export type AdminImportUrlConfig = {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
  acceptedProtocols: string[];
};

export type AdminImportMediaValidationConfig = {
  profiles: Array<{
    id: ImportOutputProfile;
    label: string;
    description: string;
  }>;
};

export type AdminImportJobsWithUploadResponse = AdminImportJobsResponse & {
  upload: AdminImportUploadConfig;
  url: AdminImportUrlConfig;
  mediaValidation: AdminImportMediaValidationConfig;
};

export type AdminImportUploadResult = {
  job: ImportJob;
  receivedBytes: number;
};

export type AdminImportMediaValidationResult = {
  job: ImportJob;
  validation: ImportMediaDecision;
};

export async function getAdminImportJobs() {
  const response = await apiFetch('/api/admin/imports', { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return response.json() as Promise<AdminImportJobsWithUploadResponse>;
}

export async function createAdminImportUpload(file: File) {
  const response = await apiFetch('/api/admin/imports/uploads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ fileName: file.name, size: file.size })
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.job;
}

export function uploadAdminImportFile(
  jobId: string,
  file: File,
  onProgress: (loaded: number, total: number) => void
) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<AdminImportUploadResult>((resolve, reject) => {
    xhr.open('PUT', `/api/admin/imports/uploads/${encodeURIComponent(jobId)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Home-Music-Request', '1');
    xhr.upload.onprogress = event => {
      const total = event.lengthComputable && event.total > 0 ? event.total : file.size;
      onProgress(Math.min(event.loaded, total), total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
      const payload = parseXhrPayload(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && payload?.job && typeof payload.receivedBytes === 'number') {
        onProgress(file.size, file.size);
        resolve({ job: payload.job, receivedBytes: payload.receivedBytes });
        return;
      }
      reject(new Error(payload?.error || `Falha HTTP ${xhr.status || 0}`));
    };
    xhr.onerror = () => reject(new Error('A conexão foi interrompida durante o upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelado.'));
    xhr.send(file);
  });

  return { xhr, promise };
}

export async function cancelAdminImportUpload(jobId: string) {
  const response = await apiFetch(`/api/admin/imports/uploads/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.job;
}

export async function createAdminImportUrl(url: string) {
  const response = await apiFetch('/api/admin/imports/urls', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ url })
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.job;
}

export async function cancelAdminImportUrl(jobId: string) {
  const response = await apiFetch(`/api/admin/imports/urls/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: { 'X-Home-Music-Request': '1' }
  });
  const payload = await response.json().catch(() => null) as { job?: ImportJob; error?: string } | null;
  if (!response.ok || !payload?.job) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload.job;
}

export async function validateAdminImportMedia(jobId: string, profile: ImportOutputProfile) {
  const response = await apiFetch(`/api/admin/imports/${encodeURIComponent(jobId)}/validate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Home-Music-Request': '1'
    },
    body: JSON.stringify({ profile })
  });
  const payload = await response.json().catch(() => null) as {
    job?: ImportJob;
    validation?: ImportMediaDecision;
    error?: string;
  } | null;
  if (!response.ok || !payload?.job || !payload.validation) {
    throw new Error(payload?.error || `Falha HTTP ${response.status}`);
  }
  return payload as AdminImportMediaValidationResult;
}

function parseXhrPayload(value: string) {
  try {
    return JSON.parse(value) as { job?: ImportJob; receivedBytes?: number; error?: string };
  } catch {
    return null;
  }
}
