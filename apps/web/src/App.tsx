import { lazy, useEffect, useState } from 'react';
import { AuthenticatedApp } from './AuthenticatedApp';
import { LazySurfaceBoundary } from './components/LazySurfaceBoundary';
import { LoginScreen } from './components/LoginScreen';
import { useOfflineDownloads } from './offline-downloads';
import { useAuth } from './useAuth';

async function loadOfflineApp() {
  const module = await import('./OfflineApp');
  return { default: module.OfflineApp };
}

const OfflineApp = lazy(loadOfflineApp);

export default function App() {
  const auth = useAuth();
  const offline = useOfflineDownloads();
  const [offlineMode, setOfflineMode] = useState(false);
  const offlineCount = offline.supported && !offline.loading ? offline.records.length : 0;
  const automaticOfflineMode = auth.unreachable && offlineCount > 0;
  const showOfflineMode = offlineMode || automaticOfflineMode;

  useEffect(() => {
    if (!auth.authenticated || !offline.supported) return;
    void loadOfflineApp().catch(() => undefined);
  }, [auth.authenticated, offline.supported]);

  useEffect(() => {
    if (offlineMode && !offline.loading && offline.tracks.length === 0) setOfflineMode(false);
  }, [offline.loading, offline.tracks.length, offlineMode]);

  if (showOfflineMode) {
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
    return (
      <LoginScreen
        configured={auth.configured}
        error={auth.error}
        unreachable={auth.unreachable}
        onLogin={auth.login}
        onRetry={() => void auth.retry()}
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
