import { useEffect, useState } from 'react';
import { AuthenticatedApp } from './AuthenticatedApp';
import { LoginScreen } from './components/LoginScreen';
import { OfflineApp } from './OfflineApp';
import { readOfflineColdStartRecords } from './offline-cold-start';
import { useOfflineDownloads, type OfflineDownloadRecord, type OfflineDownloads } from './offline-downloads';
import { useAuth } from './useAuth';

function offlineSnapshot(
  offline: OfflineDownloads,
  records: readonly OfflineDownloadRecord[]
): OfflineDownloads {
  const available = [...records];
  return {
    ...offline,
    records: available,
    tracks: available.map(record => record.track),
    downloadedIds: new Set(available.map(record => record.track.id)),
    totalBytes: available.reduce((total, record) => total + record.size, 0),
    loading: false
  };
}

export default function App() {
  const auth = useAuth();
  const offline = useOfflineDownloads();
  const [offlineMode, setOfflineMode] = useState(false);
  const [coldStartRecords, setColdStartRecords] = useState<OfflineDownloadRecord[] | null>(null);

  useEffect(() => {
    let disposed = false;

    // Com rede disponível, useOfflineDownloads já reconcilia o namespace físico.
    // App cobre somente o cold start realmente offline, sem duplicar cache.keys().
    if (!auth.unreachable || offline.records.length === 0 || navigator.onLine !== false) {
      setColdStartRecords(null);
      return () => { disposed = true; };
    }

    setColdStartRecords(null);
    void readOfflineColdStartRecords(offline.records)
      .then(records => {
        if (!disposed && records !== null) setColdStartRecords(records);
      })
      .catch(() => undefined);

    return () => { disposed = true; };
  }, [auth.unreachable, offline.records]);

  useEffect(() => {
    if (offlineMode && !offline.loading && offline.tracks.length === 0) setOfflineMode(false);
  }, [offline.loading, offline.tracks.length, offlineMode]);

  const automaticOfflineMode = auth.unreachable && offline.records.length > 0;
  const showOfflineMode = offlineMode || automaticOfflineMode;
  const offlineForMode = automaticOfflineMode
    ? offlineSnapshot(offline, coldStartRecords ?? offline.records)
    : offline;

  if (showOfflineMode) {
    return (
      <OfflineApp
        offline={offlineForMode}
        onExit={() => {
          setOfflineMode(false);
          void auth.retry();
        }}
      />
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
