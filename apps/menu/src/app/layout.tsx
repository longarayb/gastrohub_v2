import type { Metadata, Viewport } from 'next';
import { menuFont } from '@app/ui/fonts/menu';
import { requestOrigin } from '@/lib/origin';
import { storeCssVariables } from '@/lib/theme';
import { Providers } from './providers';
import './globals.css';

// Each restaurant page sets its own name, colors and icon (the menu shows their brand, not ours).
export async function generateMetadata(): Promise<Metadata> {
  return {
    // Absolute links (preview image) follow the address the visitor used (LAN, tunnel, domain).
    metadataBase: new URL(await requestOrigin()),
    title: { default: 'Cardápio digital', template: '%s' },
    description: 'Peça online direto do restaurante',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={menuFont.variable}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: storeCssVariables(null) }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
