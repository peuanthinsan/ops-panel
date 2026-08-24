'use client';

import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(registrations.map(registration => registration.unregister()))).catch(() => {});
      if ('caches' in window) caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('songdee-ops-shell-')).map(key => caches.delete(key)))).catch(() => {});
      return undefined;
    }
    let active = true;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => {
      if (!active) return;
      registration.update().catch(() => {});
    }).catch(() => {
      // The dashboard still works online when a browser blocks service workers.
    });
    return () => { active = false; };
  }, []);

  return null;
}
