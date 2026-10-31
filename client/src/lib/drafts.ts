import { useCallback, useEffect, useState } from 'react';
function read(key: string) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
export function useDraft(key: string) {
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const value = state.key === key ? state.value : read(key);
  useEffect(() => {
    if (state.key !== key) return;
    try {
      if (state.value) localStorage.setItem(key, state.value);
      else localStorage.removeItem(key);
    } catch {}
  }, [key, state]);
  const setValue = useCallback(
    (next: string | ((old: string) => string)) =>
      setState((old) => ({
        key,
        value: typeof next === 'function' ? next(old.key === key ? old.value : read(key)) : next,
      })),
    [key],
  );
  return [value, setValue] as const;
}
export function clearDrafts(userId: string) {
  try {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`po:draft:${userId}:`)) localStorage.removeItem(key);
  } catch {}
}
