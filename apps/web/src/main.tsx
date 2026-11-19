import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { StoreProvider } from './store.js';
import { NetProvider } from './netStore.js';
import './styles.css';

const savedTheme = localStorage.getItem('dnd5e-theme');
if (savedTheme) {
  document.documentElement.dataset.theme = savedTheme;
} else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
  // nessun tema salvato: segui il tema di sistema del dispositivo
  document.documentElement.dataset.theme = 'light';
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <NetProvider>
        <App />
      </NetProvider>
    </StoreProvider>
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}

