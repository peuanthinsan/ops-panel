import { Pressable, StyleSheet, Text } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../lib/theme';

type ThemeToggleProps = {
  language: 'en' | 'th';
  compact?: boolean;
  onHeader?: boolean;
};

const nextPreference = { dark: 'light', light: 'system', system: 'dark' } as const;
const labels = {
  en: { dark: 'Dark', light: 'Light', system: 'Auto' },
  th: { dark: 'มืด', light: 'สว่าง', system: 'อัตโนมัติ' },
};
const hints = {
  en: { dark: 'Switch to dark mode', light: 'Switch to light mode', system: 'Follow system theme automatically' },
  th: { dark: 'เปลี่ยนเป็นโหมดมืด', light: 'เปลี่ยนเป็นโหมดสว่าง', system: 'ใช้ธีมตามการตั้งค่าระบบโดยอัตโนมัติ' },
};

export function ThemeToggle({ language, compact = false, onHeader = true }: ThemeToggleProps) {
  const { colors, preference, setPreference } = useTheme();
  const label = labels[language][preference];
  const foreground = onHeader ? colors.headerText : colors.text;
  const borderColor = onHeader ? colors.headerBorder : colors.inputBorder;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={language === 'en' ? `Theme: ${label}` : `ธีม: ${label}`}
      accessibilityHint={hints[language][nextPreference[preference]]}
      onPress={() => setPreference(nextPreference[preference])}
      style={({ pressed }) => [styles.button, compact && styles.compactButton, { borderColor }, pressed && styles.pressed]}
    >
      <Svg accessible={false} width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={foreground} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {preference === 'system'
          ? <Path d="M4 3h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm4 18h8m-4-5v5" />
          : preference === 'dark'
            ? <Path d="M20.6 14.1A8.5 8.5 0 0 1 9.9 3.4a8.5 8.5 0 1 0 10.7 10.7Z" />
            : <><Circle cx={12} cy={12} r={4} /><Path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
      </Svg>
      <Text style={[styles.label, compact && styles.compactText, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', gap: 6, flexShrink: 0, minWidth: 48, minHeight: 48, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  compactButton: { gap: 4, paddingHorizontal: 8 },
  label: { fontSize: 12, fontWeight: '700' },
  compactText: { fontSize: 11 },
  pressed: { opacity: 0.7 },
});
