function recoverTvFocus(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;

  const root = document.querySelector<HTMLElement>('.tv-app');
  if (!root) return;

  const active = document.activeElement as HTMLElement | null;
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
