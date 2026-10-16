import { BRAND } from '@app/shared';
import { useColorScheme } from 'react-native';

/**
 * Tokens of the courier app (same idea as the panel's theme: no loose colors in the screens).
 * Values follow docs/DESIGN.md (dark by default, solid badges with 4.5:1 text).
 */
const dark = {
  background: '#0b111c',
  card: '#131b2a',
  border: '#26324a',
  foreground: '#f1f4f9',
  muted: '#9aa7bd',
  primary: BRAND.colors.dark.primary,
  primaryForeground: BRAND.colors.dark.primaryForeground,
  success: '#3fcf8e',
  successForeground: '#062314',
  warning: '#f5a524',
  warningForeground: '#2b1a00',
  danger: '#f26b5f',
  dangerForeground: '#2b0703',
  info: '#5694f7',
  infoForeground: '#0b111c',
};

const light: typeof dark = {
  background: '#f4f6fa',
  card: '#ffffff',
  border: '#d6dde8',
  foreground: '#0b111c',
  muted: '#55627a',
  primary: BRAND.colors.light.primary,
  primaryForeground: BRAND.colors.light.primaryForeground,
  success: '#107a52',
  successForeground: '#ffffff',
  warning: '#9a5c00',
  warningForeground: '#ffffff',
  danger: '#c0362b',
  dangerForeground: '#ffffff',
  info: '#2a66cc',
  infoForeground: '#ffffff',
};

export type Theme = typeof dark;

export function useTheme(): Theme {
  return useColorScheme() === 'light' ? light : dark;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { md: 10, lg: 14 };
export const text = { sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 };
