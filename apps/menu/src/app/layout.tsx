import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { MENU_URL } from '@/lib/api';
import { storeCssVariables } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-app', display: 'swap' });

// Each restaurant page sets its own name, colors and icon (the menu shows their brand, not ours).
export const metadata: Metadata = {
  metadataBase: new URL(MENU_URL),
  title: { default: 'Cardápio digital', template: '%s' },
  description: 'Peça online direto do restaurante',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: storeCssVariables(null) }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
