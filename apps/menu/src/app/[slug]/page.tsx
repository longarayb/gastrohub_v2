import { MenuView } from '@/components/menu-view';
import { requestOrigin } from '@/lib/origin';
import { getCatalog, getStore } from './data';

type Params = { params: Promise<{ slug: string }> };

/** Restaurant menu: rendered on the server (fast first paint and SEO), cached per restaurant. */
export default async function StoreMenuPage({ params }: Params) {
  const { slug } = await params;
  const [store, catalog, origin] = await Promise.all([
    getStore(slug),
    getCatalog(slug),
    requestOrigin(),
  ]);
  // Structured data: the restaurant, its address and opening hours (search engines).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: store.name,
    description: store.description ?? undefined,
    url: `${origin}/${slug}`,
    image: store.logoUrl ?? undefined,
    telephone: store.phone ? `+55${store.phone}` : undefined,
    address: store.address
      ? {
          '@type': 'PostalAddress',
          streetAddress: `${store.address.street}, ${store.address.number}`,
          addressLocality: store.address.city,
          addressRegion: store.address.state,
          addressCountry: 'BR',
        }
      : undefined,
    openingHoursSpecification: store.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
        h.weekday
      ],
      opens: h.opensAt,
      closes: h.closesAt,
    })),
    hasMenu: `${origin}/${slug}`,
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <MenuView store={store} catalog={catalog} />
    </>
  );
}
