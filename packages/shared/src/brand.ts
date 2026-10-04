/**
 * Product identity — the ONLY place where the product name, logo and brand colors live.
 *
 * Image assets (logo, favicon) live in packages/ui/assets/brand/ and are copied to each
 * app at /brand/* by scripts/sync-brand-assets.mjs.
 *
 * The current name is provisional. To rebrand, edit this file and the assets (and optionally set
 * `APP_NAME` in the environment to override the name in server-generated content
 * such as e-mails and the Swagger title). Code, packages (@app/*), database and
 * containers use neutral names and never reference the brand directly.
 */

export interface BrandColorScheme {
  /** Main brand color (buttons, highlights, focus ring). Any CSS color. */
  primary: string;
  /** Text/icon color on top of `primary`. */
  primaryForeground: string;
}

export interface Brand {
  name: string;
  tagline: string;
  /** Short marketing line used on the login screen. */
  headline: string;
  logo: {
    /** Path of the logo inside each app (`null` renders the default icon mark). */
    src: string | null;
  };
  /** Path of the favicon inside each app. */
  favicon: string;
  colors: {
    light: BrandColorScheme;
    dark: BrandColorScheme;
    /** Hex version of the primary color, for e-mails and `<meta name="theme-color">`. */
    primaryHex: string;
  };
}

export const BRAND: Brand = {
  name: 'GastroHub',
  tagline: 'Gestão para restaurantes, bares e deliveries',
  headline: 'Pedidos, salão, cozinha e delivery em um só lugar.',
  logo: { src: '/brand/logo.svg' },
  favicon: '/brand/favicon.svg',
  colors: {
    light: { primary: 'oklch(0.64 0.19 42)', primaryForeground: 'oklch(0.99 0 0)' },
    dark: { primary: 'oklch(0.7 0.18 45)', primaryForeground: 'oklch(0.16 0.01 60)' },
    primaryHex: '#ea580c',
  },
};

/**
 * CSS custom properties with the brand colors, injected by each app's root layout.
 * The shared theme (`@app/ui/globals.css`) reads `--primary`, `--primary-foreground`
 * and `--ring` from here.
 */
export function brandCssVariables(brand: Brand = BRAND): string {
  const vars = (c: BrandColorScheme) =>
    `--primary:${c.primary};--primary-foreground:${c.primaryForeground};--ring:${c.primary};`;
  return `:root{${vars(brand.colors.light)}}.dark{${vars(brand.colors.dark)}}`;
}
