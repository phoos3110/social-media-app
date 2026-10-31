import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { api } from './api';
export function usePresence(ids: string[], socket: Socket | null) {
  const key = [...new Set(ids)].sort().join(',');
  const [online, setOnline] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    const update = () => {
      if (!key) {
        setOnline([]);
        return;
      }
      void api<{ online: string[] }>(`/presence?ids=${key}`)
        .then((data) => {
          if (active) setOnline(data.online);
        })
        .catch(() => {});
    };
    update();
    socket?.on('presence:changed', update);
    socket?.on('connect', update);
    const offline = () => setOnline([]);
    socket?.on('disconnect', offline);
    return () => {
      active = false;
      socket?.off('presence:changed', update);
      socket?.off('connect', update);
      socket?.off('disconnect', offline);
    };
  }, [key, socket]);
  return online;
}
