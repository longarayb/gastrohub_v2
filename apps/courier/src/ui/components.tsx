import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { radius, space, text, useTheme } from './theme';

/** Building blocks of the courier app's screens (large touch targets: used on a motorcycle). */

type Variant = 'primary' | 'outline' | 'danger' | 'ghost';

export function Button({
  label,
  onPress,
  variant = 'primary',
  busy = false,
  disabled = false,
  big = false,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
  big?: boolean;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.primary : variant === 'danger' ? t.danger : 'transparent';
  const fg =
    variant === 'primary'
      ? t.primaryForeground
      : variant === 'danger'
        ? t.dangerForeground
        : t.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        {
          backgroundColor: bg,
          borderColor: variant === 'outline' ? t.border : bg,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Card({
  children,
  accent,
  label,
}: {
  children: React.ReactNode;
  accent?: string;
  label?: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel={label}
      style={[
        styles.card,
        { backgroundColor: t.card, borderColor: t.border },
        accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
      ]}
    >
      {children}
    </View>
  );
}

export function Title({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.title, { color: t.foreground }]}>{children}</Text>;
}

export function Body({
  children,
  muted = false,
  bold = false,
  size = 'md',
}: {
  children: React.ReactNode;
  muted?: boolean;
  bold?: boolean;
  size?: keyof typeof text;
}) {
  const t = useTheme();
  return (
    <Text
      style={{
        color: muted ? t.muted : t.foreground,
        fontSize: text[size],
        fontWeight: bold ? '700' : '400',
        lineHeight: text[size] * 1.35,
      }}
    >
      {children}
    </Text>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: 'info' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const t = useTheme();
  const color = tone === 'info' ? t.info : tone === 'warning' ? t.warning : t.danger;
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, { borderLeftColor: color, backgroundColor: t.background }]}
    >
      <Text style={{ color: t.foreground, fontSize: text.md, lineHeight: text.md * 1.35 }}>
        {children}
      </Text>
    </View>
  );
}

export function Badge({
  label,
  tone,
}: {
  label: string;
  tone: 'info' | 'success' | 'danger' | 'warning';
}) {
  const t = useTheme();
  const bg = { info: t.info, success: t.success, danger: t.danger, warning: t.warning }[tone];
  const fg = {
    info: t.infoForeground,
    success: t.successForeground,
    danger: t.dangerForeground,
    warning: t.warningForeground,
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: text.sm }}>{label}</Text>
    </View>
  );
}

export function Field({
  label,
  error,
  ...props
}: TextInputProps & { label: string; error?: string | null }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: t.foreground, fontSize: text.sm, fontWeight: '600' }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          {
            color: t.foreground,
            backgroundColor: t.background,
            borderColor: error ? t.danger : focused ? t.primary : t.border,
          },
        ]}
      />
      {error ? <Text style={{ color: t.danger, fontSize: text.sm }}>{error}</Text> : null}
    </View>
  );
}

/** Full-height sheet over the screen (consent, payment, failure, battery). */
export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.sheet, { backgroundColor: t.background }]}>
        <Title>{title}</Title>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: space.xl }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBig: { minHeight: 64 },
  buttonText: { fontSize: text.md, fontWeight: '700' },
  buttonTextBig: { fontSize: text.lg },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  title: { fontSize: text.xl, fontWeight: '800' },
  notice: { borderLeftWidth: 4, borderRadius: radius.md, padding: space.md },
  badge: {
    borderRadius: 6,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: text.lg,
  },
  sheet: { flex: 1, padding: space.lg, paddingTop: space.xl * 2, gap: space.md },
});
