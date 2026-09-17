export type TvDeviceLoginState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';

export type TvDeviceLoginStart = Readonly<{
  requestId: string;
  deviceToken: string;
  approvalToken: string;
  displayCode: string;
  expiresAt: string;
}>;

type ErrorPayload = {
  error?: string;
  state?: TvDeviceLoginState;
};

const MUTATION_HEADERS = { 'X-Home-Music-Request': '1' } as const;
const DEVICE_TOKEN_HEADER = 'X-Home-Music-Device-Token';

export class TvDeviceLoginHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly state?: TvDeviceLoginState,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'TvDeviceLoginHttpError';
  }
}

async function errorFromResponse(response: Response) {
  let payload: ErrorPayload = {};
  try {
    payload = await response.json() as ErrorPayload;
  } catch {
    // Respostas sem JSON continuam virando um erro público estável.
  }
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new TvDeviceLoginHttpError(
    payload.error || `Falha HTTP ${response.status}`,
    response.status,
    payload.state,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
  );
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function approvalMutation(approvalToken: string) {
  return {
    method: 'POST',
    headers: {
      ...MUTATION_HEADERS,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ approvalToken })
  } satisfies RequestInit;
}

function deviceHeaders(deviceToken: string, mutation = false) {
  return mutation
    ? { ...MUTATION_HEADERS, [DEVICE_TOKEN_HEADER]: deviceToken }
    : { [DEVICE_TOKEN_HEADER]: deviceToken };
}

export function startTvDeviceLogin() {
  return requestJson<TvDeviceLoginStart>('/api/auth/device/start', {
    method: 'POST',
    headers: MUTATION_HEADERS
  });
}

export function getTvDeviceLoginStatus(requestId: string, deviceToken: string) {
  return requestJson<{ state: TvDeviceLoginState }>(
    `/api/auth/device/${encodeURIComponent(requestId)}/status`,
    { method: 'GET', headers: deviceHeaders(deviceToken) }
  );
}

export function previewTvDeviceLogin(approvalToken: string) {
  return requestJson<{ displayCode: string }>(
    '/api/auth/device/preview',
    approvalMutation(approvalToken)
  );
}

export function approveTvDeviceLogin(approvalToken: string) {
  return requestJson<{ approved: true; displayCode: string }>(
    '/api/auth/device/approve',
    approvalMutation(approvalToken)
  );
}

export function denyTvDeviceLogin(approvalToken: string) {
  return requestJson<void>('/api/auth/device/deny', approvalMutation(approvalToken));
}

export function consumeTvDeviceLogin(requestId: string, deviceToken: string) {
  return requestJson<{ authenticated: true }>(
    `/api/auth/device/${encodeURIComponent(requestId)}/consume`,
    {
      method: 'POST',
      headers: deviceHeaders(deviceToken, true)
    }
  );
}

export function cancelTvDeviceLogin(requestId: string, deviceToken: string) {
  return requestJson<void>(
    `/api/auth/device/${encodeURIComponent(requestId)}`,
    {
      method: 'DELETE',
      headers: deviceHeaders(deviceToken, true)
    }
  );
}
