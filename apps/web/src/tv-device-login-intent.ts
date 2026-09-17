const TV_LOGIN_PATH = '/tv-login';
const MAX_TOKEN_LENGTH = 128;

function validApprovalToken(value: string) {
  return value.length >= 16
    && value.length <= MAX_TOKEN_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

export function readTvDeviceApprovalIntent(location: { pathname: string; hash: string }) {
  if (location.pathname !== TV_LOGIN_PATH) return null;
  const token = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  if (!validApprovalToken(token)) return null;
  return token;
}

export function approvalLocationWithoutToken(location: { pathname: string; search: string }) {
  return `${location.pathname}${location.search}`;
}

export function tvDeviceApprovalUrl(origin: string, approvalToken: string) {
  return `${origin.replace(/\/$/, '')}${TV_LOGIN_PATH}#${approvalToken}`;
}
