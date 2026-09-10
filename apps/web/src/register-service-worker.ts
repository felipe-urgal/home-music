const SHELL_REFRESH_REQUEST = 'HOME_MUSIC_REFRESH_SHELL';

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  let registrationPromise: Promise<ServiceWorkerRegistration> | null = null;

  const refreshShell = async () => {
    if (navigator.onLine === false) return;
    const registration = await (registrationPromise ?? navigator.serviceWorker.ready);
    const worker = navigator.serviceWorker.controller ?? registration.active;
    worker?.postMessage({ type: SHELL_REFRESH_REQUEST });
  };

  const register = async () => {
    registrationPromise = navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await registrationPromise;
    await refreshShell();
  };

  window.addEventListener('online', () => { void refreshShell().catch(() => undefined); });

  if (document.readyState === 'complete') {
    void register().catch(() => undefined);
    return;
  }

  window.addEventListener('load', () => { void register().catch(() => undefined); }, { once: true });
}
