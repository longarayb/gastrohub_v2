import type { MetadataRoute } from 'next';
import { MENU_URL } from '@/lib/api';

export default function robots(): MetadataRoute.Robots {
  return {
    // Personal tracking links stay out of search engines.
    rules: { userAgent: '*', allow: '/', disallow: ['/*/pedido/', '/api/'] },
    sitemap: `${MENU_URL}/sitemap.xml`,
  };
}
