import { BRAND } from '@app/shared';
import type { Metadata, Viewport } from 'next';
import { requestOrigin } from '@/lib/origin';
import { storeCssVariables, storeThemeColor } from '@/lib/theme';
import { getStore } from './data';

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const [store, origin] = await Promise.all([getStore(slug), requestOrigin()]);
  // Absolute preview image on the address the visitor (or WhatsApp) used.
  const image = {
    url: `${origin}/${slug}/og`,
    width: 1200,
    height: 630,
    alt: store.name,
  };
  const title = `${store.name} · Cardápio e pedidos`;
  const description =
    store.description ??
    `Peça online no ${store.name}${store.delivers ? ': entrega e retirada' : ': retirada no local'}.`;
  return {
    title,
    description,
    alternates: { canonical: `/${slug}` },
    icons: store.logoUrl ? { icon: store.logoUrl, apple: store.logoUrl } : undefined,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `/${slug}`,
      siteName: store.name,
      locale: 'pt_BR',
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

export async function generateViewport({ params }: Params): Promise<Viewport> {
  const { slug } = await params;
  const store = await getStore(slug);
  return { themeColor: storeThemeColor(store.brandColor) };
}

/** A restaurant's pages: its color, and our brand only as a discreet "feito com". */
export default async function StoreLayout({
  children,
  params,
}: Params & { children: React.ReactNode }) {
  const { slug } = await params;
  const store = await getStore(slug);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: storeCssVariables(store.brandColor) }} />
      {children}
      <footer className="px-4 pt-6 pb-28 text-center text-xs text-muted-foreground">
        feito com {BRAND.name}
      </footer>
    </>
  );
}
