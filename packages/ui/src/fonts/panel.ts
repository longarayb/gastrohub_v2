import localFont from 'next/font/local';

/**
 * Panel font (docs/DESIGN.md): Nunito Sans, variable weight, embedded in the build from
 * packages/ui/assets/fonts (SIL Open Font License). No request to Google Fonts at build or
 * run time (unstable connections, LGPD). Latin subset: Portuguese is fully covered.
 */
export const panelFont = localFont({
  src: '../../assets/fonts/nunito-sans-latin-wght-normal.woff2',
  weight: '200 1000',
  style: 'normal',
  display: 'swap',
  variable: '--font-app',
});
