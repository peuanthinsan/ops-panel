let memoryToken = '';

function browserStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  }
  catch { return null; }
}

export function getAdminSessionToken() {
  const storage = browserStorage();
  if (!storage) return memoryToken;
  try { return storage.getItem('songdee-admin-token') || memoryToken; }
  catch { return memoryToken; }
}

export function setAdminSessionToken(token) {
  memoryToken = String(token || '');
  try { browserStorage()?.setItem('songdee-admin-token', memoryToken); }
  catch { /* Keep the session in memory when browser storage is unavailable. */ }
}

export function clearAdminSessionToken() {
  memoryToken = '';
  try {
    browserStorage()?.removeItem('songdee-admin-token');
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('songdee-admin-token');
  }
  catch { /* The in-memory session is already cleared. */ }
}
