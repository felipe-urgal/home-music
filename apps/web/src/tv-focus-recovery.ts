function recoverTvFocus(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

  const root = document.querySelector<HTMLElement>('.tv-app');
  if (!root) return;

  const active = document.activeElement as HTMLElement | null;
  const modal = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
  if (modal) {
    if (active && modal.contains(active)) return;
    const modalTarget = modal.querySelector<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    if (modalTarget) {
      event.preventDefault();
      event.stopImmediatePropagation();
      modalTarget.focus({ preventScroll: true });
    }
    return;
  }

  if (active && root.contains(active)) return;

  const target = root.querySelector<HTMLElement>('[data-tv-zone="sidebar"].is-active:not(:disabled)')
    ?? root.querySelector<HTMLElement>('[data-tv-zone="sidebar"]:not(:disabled)')
    ?? root.querySelector<HTMLElement>('[data-tv-zone="content"]:not(:disabled)');
  if (!target) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  target.focus({ preventScroll: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', recoverTvFocus);
}
