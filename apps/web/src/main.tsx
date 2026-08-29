import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RequiredPasswordGate } from './components/RequiredPasswordGate';
import { registerServiceWorker } from './register-service-worker';
import './styles.css';
import './features.css';
import './artwork.css';
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
import './administration.css';
import './admin-import-upload.css';
import './admin-import-media-validation.css';
import './admin-import-metadata-preview.css';
import './desktop-shell.css';
import './tablet-shell.css';
import './desktop-player.css';
import './desktop-library.css';
import './desktop-context.css';
import './desktop-scrollbars.css';
import './desktop-navigation.css';
import './phase7-interactions.css';
import './desktop-now-playing.css';
import './account-shell.css';
import './desktop-overlays.css';
import './mobile-shell.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RequiredPasswordGate>
      <App />
    </RequiredPasswordGate>
  </StrictMode>
);

registerServiceWorker();
