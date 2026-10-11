import { BRAND, brandCssVariables } from '@app/shared';
import { panelFont } from '@app/ui/fonts/panel';
import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `Plataforma · ${BRAND.name}`, template: `%s · Plataforma ${BRAND.name}` },
  icons: { icon: BRAND.favicon },
  // Private admin area: never indexed.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#0b111c' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={panelFont.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: brandCssVariables() }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
