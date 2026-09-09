import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../lib/theme';

type ThemeToggleProps = {
  language: 'en' | 'th';
  compact?: boolean;
  onHeader?: boolean;
};

export function ThemeToggle({ language, compact = false, onHeader = true }: ThemeToggleProps) {
  const { colors, scheme, preference, setPreference } = useTheme();
  const dark = scheme === 'dark';
  const automatic = preference === 'system';
  const foreground = onHeader ? colors.headerText : colors.text;
  const borderColor = onHeader ? colors.headerBorder : colors.inputBorder;
  return (
    <View style={[styles.group, compact && styles.compactGroup]}>
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={language === 'en' ? 'Dark mode' : 'โหมดมืด'}
        accessibilityHint={language === 'en'
          ? (dark ? 'Switch to light mode' : 'Switch to dark mode')
          : (dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด')}
        accessibilityState={{ checked: dark }}
        onPress={() => setPreference(dark ? 'light' : 'dark')}
        style={({ pressed }) => [styles.iconButton, { borderColor }, pressed && styles.pressed]}
      >
        <Svg accessible={false} width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={foreground} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          {dark
            ? <Path d="M20.6 14.1A8.5 8.5 0 0 1 9.9 3.4a8.5 8.5 0 1 0 10.7 10.7Z" />
            : <><Circle cx={12} cy={12} r={4} /><Path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>}
        </Svg>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={language === 'en' ? 'Follow system theme' : 'ใช้ธีมตามการตั้งค่าระบบ'}
        accessibilityState={{ selected: automatic }}
        onPress={() => setPreference('system')}
        style={({ pressed }) => [
          styles.autoButton,
          { borderColor: automatic ? foreground : 'transparent', backgroundColor: automatic ? (onHeader ? '#303030' : colors.selectedSurface) : 'transparent' },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.autoText, compact && styles.compactText, { color: automatic && !onHeader ? colors.selectedText : foreground }]}>{language === 'en' ? 'Auto' : 'อัตโนมัติ'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  compactGroup: { gap: 4 },
  iconButton: { width: 48, height: 48, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  autoButton: { minWidth: 48, minHeight: 48, paddingHorizontal: 7, paddingVertical: 8, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  autoText: { fontSize: 12, fontWeight: '700' },
  compactText: { fontSize: 11 },
  pressed: { opacity: 0.7 },
});
