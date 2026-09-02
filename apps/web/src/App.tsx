import { lazy, useEffect, useState } from 'react';
import { AuthenticatedApp } from './AuthenticatedApp';
import { LazySurfaceBoundary } from './components/LazySurfaceBoundary';
import { LoginScreen } from './components/LoginScreen';
import { useOfflineDownloads } from './offline-downloads';
import { useAuth } from './useAuth';

const OfflineApp = lazy(async () => {
  const module = await import('./OfflineApp');
  return { default: module.OfflineApp };
});

export default function App() {
  const auth = useAuth();
  const offline = useOfflineDownloads();
  const [offlineMode, setOfflineMode] = useState(false);
  const [offlineAutoOpened, setOfflineAutoOpened] = useState(false);

  useEffect(() => {
    if (!auth.unreachable) {
      if (offlineAutoOpened) setOfflineAutoOpened(false);
      return;
    }
    if (
      offlineAutoOpened
      || auth.loading
      || offline.loading
      || !offline.supported
      || offline.records.length === 0
    ) return;

    setOfflineAutoOpened(true);
    setOfflineMode(true);
  }, [
    auth.loading,
    auth.unreachable,
    offline.loading,
    offline.records.length,
    offline.supported,
    offlineAutoOpened
  ]);

  useEffect(() => {
    if (offlineMode && !offline.loading && offline.tracks.length === 0) setOfflineMode(false);
  }, [offline.loading, offline.tracks.length, offlineMode]);

  if (offlineMode) {
    return (
      <LazySurfaceBoundary fullScreen loadingTitle="Carregando modo offline">
        <OfflineApp
          offline={offline}
          onExit={() => {
            setOfflineMode(false);
            void auth.retry();
          }}
        />
      </LazySurfaceBoundary>
    );
  }

  if (auth.loading) {
    return (
      <main className="login-shell">
        <section className="login-card login-card--status" aria-live="polite">
          <strong>Home Music</strong>
          <span>Verificando sua sessão…</span>
        </section>
      </main>
    );
  }

  if (!auth.authenticated || !auth.currentUser) {
    const offlineCount = auth.unreachable && offline.supported && !offline.loading ? offline.records.length : 0;
    return (
      <LoginScreen
        configured={auth.configured}
        error={auth.error}
        offlineCount={offlineCount}
        onLogin={auth.login}
        onRetry={() => void auth.retry()}
        onOpenOffline={offlineCount > 0 ? () => setOfflineMode(true) : undefined}
      />
    );
  }

  return (
    <AuthenticatedApp
      currentUser={auth.currentUser}
      onLogout={auth.logout}
      onAuthRefresh={auth.retry}
      onOpenOffline={() => setOfflineMode(true)}
      offline={offline}
    />
  );
}
