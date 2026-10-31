interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
type Snapshot = {
  canInstall: boolean;
  installed: boolean;
  updateAvailable: boolean;
  online: boolean;
};
const displayMode = window.matchMedia('(display-mode: standalone)');
const isStandalone = () =>
  displayMode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
let snapshot: Snapshot = {
  canInstall: false,
  installed: isStandalone(),
  updateAvailable: false,
  online: navigator.onLine,
};
const listeners = new Set<() => void>();
let installEvent: InstallEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let started = false;
let activatingUpdate = false;

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}
export const subscribePwa = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getPwaSnapshot = () => snapshot;
export function isAppleMobile() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
export function registerPwa() {
  if (started || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  started = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event as InstallEvent;
    publish({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    publish({ installed: true, canInstall: false });
  });
  displayMode.addEventListener('change', () => publish({ installed: isStandalone() }));
  window.addEventListener('online', () => publish({ online: true }));
  window.addEventListener('offline', () => publish({ online: false }));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (activatingUpdate) window.location.reload();
  });
  void navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((result) => {
      registration = result;
      if (result.waiting && navigator.serviceWorker.controller) publish({ updateAvailable: true });
      result.addEventListener('updatefound', () => {
        const worker = result.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller)
            publish({ updateAvailable: true });
        });
      });
    })
    .catch(() => {
      // Failure to register offline support must not block online use of Po.
    });
}
export async function installPwa() {
  const event = installEvent;
  if (!event) return;
  installEvent = null;
  publish({ canInstall: false });
  await event.prompt();
  await event.userChoice;
}
export function activatePwaUpdate() {
  if (!registration?.waiting) {
    publish({ updateAvailable: false });
    return;
  }
  activatingUpdate = true;
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}
export function dismissPwaUpdate() {
  publish({ updateAvailable: false });
}
