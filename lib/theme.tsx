import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Appearance, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { themeColors, type ThemeColors, type ThemeScheme } from './theme-colors';
import { createThemePreferenceStore, resolveThemeScheme, type ThemePreference } from './theme-preference';

export type { ThemeColors, ThemeScheme } from './theme-colors';
export type { ThemePreference } from './theme-preference';

const THEME_KEY = 'songdee.theme';
type ThemeContextValue = {
  colors: ThemeColors;
  scheme: ThemeScheme;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createThemePreferenceStore({
    read: () => SecureStore.getItemAsync(THEME_KEY),
    write: preference => SecureStore.setItemAsync(THEME_KEY, preference),
  }));
  const preference = useSyncExternalStore(store.subscribe, store.getPreference, () => 'system' as const);
  const [appearance, setAppearance] = useState(Appearance.getColorScheme);

  useEffect(() => { void store.hydrate(); }, [store]);

  useEffect(() => {
    const refreshAppearance = () => setAppearance(Appearance.getColorScheme());
    const subscription = Appearance.addChangeListener(({ colorScheme }) => setAppearance(colorScheme));
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refreshAppearance();
    });
    refreshAppearance();
    return () => { subscription.remove(); appState.remove(); };
  }, []);

  useEffect(() => {
    // RN 0.86 uses "unspecified" to release a native override and follow the OS.
    // Native appearance events then continue updating Auto mode while the app is open.
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
    setAppearance(Appearance.getColorScheme());
  }, [preference]);

  const scheme = resolveThemeScheme(preference, appearance);
  const colors = themeColors[scheme];
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);
  const setPreference = useCallback((next: ThemePreference) => { void store.setPreference(next); }, [store]);
  const value = useMemo(() => ({ colors, scheme, preference, setPreference }), [colors, scheme, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useTheme must be used within ThemeProvider');
  return theme;
}
