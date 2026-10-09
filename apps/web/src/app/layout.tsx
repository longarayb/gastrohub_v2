import { BRAND, brandCssVariables } from '@app/shared';
import { panelFont } from '@app/ui/fonts/panel';
import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  icons: { icon: BRAND.favicon },
  description: BRAND.tagline,
};

// Dark is the default theme (docs/DESIGN.md); <ThemeColor> follows the chosen theme after load.
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
