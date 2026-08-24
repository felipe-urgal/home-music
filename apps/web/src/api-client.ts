export const AUTH_REQUIRED_EVENT = 'home-music:auth-required';

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    ...init,
    credentials: 'same-origin'
  });

  if (response.status === 401) {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }

  return response;
}
