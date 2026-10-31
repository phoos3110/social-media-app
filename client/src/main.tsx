import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './app.css';
import './dark.css';
import './confirm.css';
import './pwa.css';
import App from './App.tsx';
import { ThemeProvider } from './components/Theme';
import { applyTheme, readTheme } from './lib/theme';
import { ConfirmProvider } from './components/Confirm';
import { PwaStatus } from './components/Pwa';
import { registerPwa } from './lib/pwa';

applyTheme(readTheme());
if (import.meta.env.PROD) registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ConfirmProvider>
        <App />
        <PwaStatus />
      </ConfirmProvider>
    </ThemeProvider>
  </StrictMode>,
);
