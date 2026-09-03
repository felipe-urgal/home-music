export const AUTH_STATUS_TIMEOUT_MS = 1500;

type AuthStatusFetch = (input: string, init?: RequestInit) => Promise<Response>;

type FetchAuthStatusOptions = {
  fetchImpl?: AuthStatusFetch;
  online?: boolean;
  timeoutMs?: number;
};

function browserReportsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export async function fetchAuthStatusResponse({
  fetchImpl = (input, init) => fetch(input, init),
  online = browserReportsOnline(),
  timeoutMs = AUTH_STATUS_TIMEOUT_MS
}: FetchAuthStatusOptions = {}) {
  if (!online) throw new Error('Navegador offline.');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl('/api/auth/status', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
