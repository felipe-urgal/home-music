import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './register-service-worker';
import './styles.css';
import './features.css';
import './artwork.css';
import './offline.css';
import './library-controls.css';
import './rekordbox.css';
import './auth.css';
import './desktop-shell.css';
import './tablet-shell.css';
import './desktop-player.css';
import './desktop-library.css';
import './desktop-context.css';
import './desktop-navigation.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

registerServiceWorker();
