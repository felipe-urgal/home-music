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

function focusableElements() {
  return [...document.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.offsetParent !== null);
}

function installAuxiliaryDpadNavigation() {
  window.addEventListener('keydown', event => {
    if (document.querySelector('.tv-app')) return;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

    const candidates = focusableElements();
    if (candidates.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || active === document.documentElement || !candidates.includes(active)) {
      event.preventDefault();
      candidates[0].focus({ preventScroll: true });
      return;
    }

    if (
      (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
      && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) return;

    const currentRect = active.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      if (candidate === active) continue;
      const rect = candidate.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const dx = x - currentX;
      const dy = y - currentY;
      const eligible = event.key === 'ArrowRight' ? dx > 4
        : event.key === 'ArrowLeft' ? dx < -4
          : event.key === 'ArrowDown' ? dy > 4
            : dy < -4;
      if (!eligible) continue;

      const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const primary = horizontal ? Math.abs(dx) : Math.abs(dy);
      const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
      const score = primary * 4 + secondary;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) return;
    event.preventDefault();
    best.focus({ preventScroll: true });
    best.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  });
}

const tvMode = readRequestedTvMode();

if (typeof document !== 'undefined') {
  if (tvMode) {
    document.documentElement.dataset.tvMode = 'true';
    installAuxiliaryDpadNavigation();
  } else {
    delete document.documentElement.dataset.tvMode;
  }
}

export function isTvMode() {
  return tvMode;
}
