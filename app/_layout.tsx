import { Slot } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { LanguageProvider } from '../lib/language';
export default function RootLayout(){return <SafeAreaProvider><LanguageProvider><Slot/></LanguageProvider></SafeAreaProvider>}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  return <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.errorPage}><Text style={styles.errorBrand}>SONGDEE OPS PANEL</Text><Text accessibilityLiveRegion="assertive" accessibilityRole="header" style={styles.errorTitle}>The app needs to restart{`\n`}แอปต้องเริ่มใหม่</Text><Text style={styles.errorBody}>A startup error occurred. Press retry, then share this message with support if it happens again.{`\n`}เกิดข้อผิดพลาดขณะเริ่มแอป กดลองอีกครั้ง และส่งข้อความนี้ให้ฝ่ายสนับสนุนหากยังเกิดซ้ำ</Text><Text selectable style={styles.errorDetails}>{error.message || String(error)}</Text><Pressable accessibilityLabel="Retry app startup / ลองเริ่มแอปอีกครั้ง" accessibilityRole="button" onPress={retry} style={styles.retry}><Text style={styles.retryText}>Retry / ลองอีกครั้ง</Text></Pressable></SafeAreaView>;
}

const styles = StyleSheet.create({ errorPage: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#EEF0F2' }, errorBrand: { color: '#E31B23', fontWeight: '900', letterSpacing: 1.5, fontSize: 13 }, errorTitle: { color: '#111111', fontSize: 26, fontWeight: '800', marginTop: 12 }, errorBody: { color: '#5E6872', fontSize: 15, lineHeight: 22, marginTop: 10 }, errorDetails: { color: '#7A1424', backgroundColor: '#FFF1F1', padding: 12, marginTop: 18, fontSize: 12 }, retry: { minHeight: 48, justifyContent: 'center', backgroundColor: '#E31B23', borderRadius: 8, padding: 14, marginTop: 20, alignItems: 'center' }, retryText: { color: '#FFFFFF', fontWeight: '800' } });
