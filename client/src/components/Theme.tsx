import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

import { applyTheme, readTheme, saveTheme, isThemeStorageEvent } from '../lib/theme';
import type { Theme } from '../lib/theme';

const ThemeContext = createContext<{ theme: Theme; toggle: () => void } | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (isThemeStorageEvent(event)) setTheme(readTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    saveTheme(next);
    setTheme(next);
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
export function ThemeToggle({ className = '' }: { className?: string }) {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('ThemeToggle must be inside ThemeProvider');
  const dark = context.theme === 'dark';
  const label = dark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
  return (
    <button
      type="button"
      className={`icon-button theme-toggle ${className}`}
      onClick={context.toggle}
      aria-label={label}
      title={label}
      aria-pressed={dark}
    >
      {dark ? <Sun size={21} /> : <Moon size={21} />}
    </button>
  );
}
