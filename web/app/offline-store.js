const databaseName = 'songdee-ops-offline';
const storeName = 'responses';
const fallbackPrefix = 'songdee-offline-response:';

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function canUseLocalStorage() {
  return typeof localStorage !== 'undefined';
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open offline storage'));
  });
}

export async function readOfflineResponse(key) {
  try {
    const database = await openDatabase();
    const record = await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('Could not read offline storage'));
    });
    database.close();
    return record?.data ?? null;
  } catch {
    if (!canUseLocalStorage()) return null;
    try {
      const raw = localStorage.getItem(`${fallbackPrefix}${key}`);
      return raw ? JSON.parse(raw).data ?? null : null;
    } catch {
      return null;
    }
  }
}

export async function writeOfflineResponse(key, data) {
  const record = { key, data, savedAt: Date.now() };
  try {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, 'readwrite').objectStore(storeName).put(record);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('Could not write offline storage'));
    });
    database.close();
    return true;
  } catch {
    if (!canUseLocalStorage()) return false;
    try {
      localStorage.setItem(`${fallbackPrefix}${key}`, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }
}

export async function clearOfflineResponses() {
  try {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const request = database.transaction(storeName, 'readwrite').objectStore(storeName).clear();
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('Could not clear offline storage'));
    });
    database.close();
  } catch { /* The localStorage fallback is cleared below when available. */ }

  if (!canUseLocalStorage()) return;
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(fallbackPrefix)) localStorage.removeItem(key);
    }
  } catch { /* Offline cache cleanup must never block logout. */ }
}
