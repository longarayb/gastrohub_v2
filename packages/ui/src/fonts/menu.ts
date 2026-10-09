import localFont from 'next/font/local';

/**
 * Digital menu font: Inter, variable weight, embedded in the build from
 * packages/ui/assets/fonts (SIL Open Font License). No request to Google Fonts at build or
 * run time (unstable connections, LGPD). Latin subset: Portuguese is fully covered.
 */
export const menuFont = localFont({
  src: '../../assets/fonts/inter-latin-wght-normal.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-app',
});
