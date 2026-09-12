import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RequiredPasswordGate } from './components/RequiredPasswordGate';
import { installPlaybackHistoryTracking } from './playback-history';
import { registerServiceWorker } from './register-service-worker';
import './tv-mode';
import './styles.css';
import './features.css';
import './artwork.css';
import './now-playing-vinyl.css';
import './offline.css';
import './library-controls.css';
import './auth.css';
import './account-password.css';
import './admin-users.css';
import './admin-users-entry.css';
import './admin-tracks.css';
import './admin-file-move.css';
import './admin-metadata.css';
import './admin-quarantine.css';
import './admin-bulk.css';
import './admin-transcode-cache.css';
import './admin-operation-history.css';
import './my-account.css';
import './personal-data-import.css';
import './profile-screen.css';
import './administration.css';
import './admin-import-upload.css';
import './admin-import-media-validation.css';
import './admin-import-metadata-preview.css';
import './admin-import-duplicates.css';
import './admin-external-provider.css';
import './desktop-shell.css';
import './tablet-shell.css';
import './desktop-player.css';
import './desktop-library.css';
import './desktop-context.css';
import './desktop-scrollbars.css';
import './desktop-navigation.css';
import './phase7-interactions.css';
import './desktop-now-playing.css';
import './desktop-lyrics.css';
import './account-shell.css';
import './desktop-overlays.css';
import './mobile-shell.css';
import './admin-import-redesign.css';
import './typography.css';
import './layout-readability.css';
import './password-screen.css';
import './sessions-screen.css';
import './playback-screen.css';
import './administration-cockpit.css';
import './admin-tracks-redesign.css';
import './admin-metadata-redesign.css';
import './admin-import-v3.css';
import './admin-integrity-v3.css';
import './account-layout-widths.css';
import './admin-users-v1.css';
import './admin-quarantine-v1.css';
import './accessibility.css';
import './immersive-now-playing.css';
import './immersive-now-playing-polish.css';
import './folder-library-visual.css';
import './now-playing-crossfade.css';
import './tv.css';
import './tv-login.css';
import './tv-v2.css';

installPlaybackHistoryTracking();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RequiredPasswordGate>
      <App />
    </RequiredPasswordGate>
  </StrictMode>
);

registerServiceWorker();
