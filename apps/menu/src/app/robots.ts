import type { MetadataRoute } from 'next';
import { requestOrigin } from '@/lib/origin';

// On request: the address comes from the request, not from the build (domain can change).
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    // Personal tracking links stay out of search engines.
    rules: { userAgent: '*', allow: '/', disallow: ['/*/pedido/', '/api/'] },
    sitemap: `${await requestOrigin()}/sitemap.xml`,
  };
}
