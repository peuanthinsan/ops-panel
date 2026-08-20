let memoryToken = '';

function browserSessionStorage() {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; }
  catch { return null; }
}

export function getAdminSessionToken() {
  const storage = browserSessionStorage();
  if (!storage) return memoryToken;
  try { return storage.getItem('songdee-admin-token') || memoryToken; }
  catch { return memoryToken; }
}

export function setAdminSessionToken(token) {
  memoryToken = String(token || '');
  try { browserSessionStorage()?.setItem('songdee-admin-token', memoryToken); }
  catch { /* Keep the session in memory when browser storage is unavailable. */ }
}

export function clearAdminSessionToken() {
  memoryToken = '';
  try { browserSessionStorage()?.removeItem('songdee-admin-token'); }
  catch { /* The in-memory session is already cleared. */ }
}
