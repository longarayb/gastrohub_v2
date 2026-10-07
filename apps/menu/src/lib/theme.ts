import { isHexColor, readableForeground } from '@app/shared';

/** Neutral theme for restaurants without a color (never our brand color). */
const NEUTRAL = { primary: '#1f2937', foreground: '#ffffff' };

/** CSS variables of the restaurant's own color (primary, text on it and focus ring). */
export function storeCssVariables(brandColor: string | null): string {
  const primary = brandColor && isHexColor(brandColor) ? brandColor : NEUTRAL.primary;
  const foreground =
    brandColor && isHexColor(brandColor) ? readableForeground(primary) : NEUTRAL.foreground;
  return `:root{--primary:${primary};--primary-foreground:${foreground};--ring:${primary};}`;
}

export const storeThemeColor = (brandColor: string | null) =>
  brandColor && isHexColor(brandColor) ? brandColor : NEUTRAL.primary;
