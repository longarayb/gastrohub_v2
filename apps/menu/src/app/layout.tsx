import { BRAND, brandCssVariables } from '@app/shared';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-app', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Cardápio digital', template: '%s · Cardápio digital' },
  icons: { icon: BRAND.favicon },
  description: 'Peça online direto do restaurante',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: BRAND.colors.primaryHex,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCssVariables() }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
