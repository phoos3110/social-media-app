import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './app.css';
import './dark.css';
import './confirm.css';
import App from './App.tsx';
import { ThemeProvider } from './components/Theme';
import { applyTheme, readTheme } from './lib/theme';
import { ConfirmProvider } from './components/Confirm';

applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ThemeProvider>
  </StrictMode>,
);
