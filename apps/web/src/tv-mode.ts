const TV_SESSION_KEY = 'home-music:tv-mode';

function readRequestedTvMode() {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  const requested = params.get('tv');

  if (requested === '1') {
    try { window.sessionStorage.setItem(TV_SESSION_KEY, '1'); } catch { /* best-effort */ }
    return true;
  }

  if (requested === '0') {
    try { window.sessionStorage.removeItem(TV_SESSION_KEY); } catch { /* best-effort */ }
    return false;
  }

  try {
    return window.sessionStorage.getItem(TV_SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

const tvMode = readRequestedTvMode();

if (typeof document !== 'undefined') {
  if (tvMode) document.documentElement.dataset.tvMode = 'true';
  else delete document.documentElement.dataset.tvMode;
}

export function isTvMode() {
  return tvMode;
}
