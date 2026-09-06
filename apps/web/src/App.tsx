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

    if (!auth.unreachable) {
      setColdStartRecords(null);
      return () => { disposed = true; };
    }

    if (offline.records.length === 0) {
      setColdStartRecords([]);
      return () => { disposed = true; };
    }

    setColdStartRecords(null);
    void readOfflineColdStartRecords(offline.records)
      .then(records => {
        if (!disposed) setColdStartRecords(records);
      })
      .catch(() => {
        if (!disposed) setColdStartRecords([]);
      });

    return () => { disposed = true; };
  }, [auth.unreachable, offline.records]);

  useEffect(() => {
    if (offlineMode && !offline.loading && offline.tracks.length === 0) setOfflineMode(false);
  }, [offline.loading, offline.tracks.length, offlineMode]);

  const automaticOfflineMode = auth.unreachable && Boolean(coldStartRecords?.length);
  const checkingOfflineContent = auth.unreachable
    && offline.records.length > 0
    && coldStartRecords === null;
  const showOfflineMode = offlineMode || automaticOfflineMode;
  const offlineForMode = automaticOfflineMode && coldStartRecords
    ? offlineSnapshot(offline, coldStartRecords)
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

  if (checkingOfflineContent) {
    return (
      <main className="login-shell">
        <section className="login-card login-card--status" aria-live="polite">
          <strong>Home Music</strong>
          <span>Verificando seus downloads offline…</span>
        </section>
      </main>
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
