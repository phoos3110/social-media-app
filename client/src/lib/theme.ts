export type Theme = 'light' | 'dark';
const storageKey = 'nhip-theme'; // Keep the existing key so saved preferences survive the rename.

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* Storage can be disabled in private browsing. */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}
export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    /* Theme still works without storage. */
  }
}
export function isThemeStorageEvent(event: StorageEvent) {
  return event.key === storageKey || event.key === null;
}
