import type { ThemeScheme } from './theme-colors.ts';

export type ThemePreference = 'system' | ThemeScheme;

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveThemeScheme(preference: ThemePreference, systemScheme: unknown): ThemeScheme {
  return preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
}

type ThemeStorage = {
  read: () => Promise<string | null>;
  write: (preference: ThemePreference) => Promise<void>;
};

/** Keeps late hydration and overlapping storage writes from undoing a user's choice. */
export function createThemePreferenceStore(storage: ThemeStorage) {
  let preference: ThemePreference = 'system';
  let revision = 0;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const update = (next: ThemePreference) => {
    if (preference === next) return;
    preference = next;
    listeners.forEach(listener => listener());
  };
  return {
    getPreference: () => preference,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async hydrate() {
      try {
        const saved = await storage.read();
        if (revision === 0) update(parseThemePreference(saved));
      } catch {
        // A storage failure must not block startup or change the current theme.
      }
    },
    setPreference(next: ThemePreference) {
      revision += 1;
      update(next);
      // Continue the queue even if one storage write fails.
      writes = writes.then(() => storage.write(next)).catch(() => {});
      return writes;
    },
  };
}
