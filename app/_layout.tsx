import { Slot } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StatusBar, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LanguageProvider } from '../lib/language';
import { ThemeProvider, useTheme, type ThemeColors } from '../lib/theme';

function AppContent() {
  const { scheme } = useTheme();
  return <><StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} /><Slot /></>;
}

export default function RootLayout() {
  return <SafeAreaProvider><ThemeProvider><LanguageProvider><AppContent /></LanguageProvider></ThemeProvider></SafeAreaProvider>;
}

type ErrorBoundaryProps = { error: Error; retry: () => void };

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <SafeAreaProvider><ThemeProvider><StartupError {...props} /></ThemeProvider></SafeAreaProvider>;
}

function StartupError({ error, retry }: ErrorBoundaryProps) {
  const { colors, scheme } = useTheme();
  const styles = useMemo(() => createErrorStyles(colors), [colors]);
  return <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.errorPage}>
    <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} />
    <Text style={styles.errorBrand}>SONGDEE OPS PANEL</Text>
    <Text accessibilityLiveRegion="assertive" accessibilityRole="header" style={styles.errorTitle}>The app needs to restart{`\n`}แอปต้องเริ่มใหม่</Text>
    <Text style={styles.errorBody}>A startup error occurred. Press retry, then share this message with support if it happens again.{`\n`}เกิดข้อผิดพลาดขณะเริ่มแอป กดลองอีกครั้ง และส่งข้อความนี้ให้ฝ่ายสนับสนุนหากยังเกิดซ้ำ</Text>
    <Text selectable style={styles.errorDetails}>{error.message || String(error)}</Text>
    <Pressable accessibilityLabel="Retry app startup / ลองเริ่มแอปอีกครั้ง" accessibilityRole="button" onPress={retry} style={styles.retry}><Text style={styles.retryText}>Retry / ลองอีกครั้ง</Text></Pressable>
  </SafeAreaView>;
}

const createErrorStyles = (colors: ThemeColors) => StyleSheet.create({
  errorPage: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: colors.background },
  errorBrand: { color: colors.accent, fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
  errorTitle: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 12 },
  errorBody: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginTop: 10 },
  errorDetails: { color: colors.errorText, backgroundColor: colors.errorSurface, padding: 12, marginTop: 18, fontSize: 12 },
  retry: { minHeight: 48, justifyContent: 'center', backgroundColor: colors.brand, borderRadius: 8, padding: 14, marginTop: 20, alignItems: 'center' },
  retryText: { color: colors.onBrand, fontWeight: '800' },
});
