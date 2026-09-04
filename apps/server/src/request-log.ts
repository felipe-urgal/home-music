const MAX_LOGGED_URL_LENGTH = 2048;

export function sanitizeRequestUrl(value: unknown) {
  if (typeof value !== 'string') return '';
  const queryIndex = value.indexOf('?');
  const pathOnly = queryIndex >= 0 ? value.slice(0, queryIndex) : value;
  return pathOnly.slice(0, MAX_LOGGED_URL_LENGTH);
}
