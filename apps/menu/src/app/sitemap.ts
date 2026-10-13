import type { MetadataRoute } from 'next';
import { serverGet } from '@/lib/api';
import { requestOrigin } from '@/lib/origin';

// Built on request (the API is not reachable at build time); the list itself is cached 1 h.
export const dynamic = 'force-dynamic';

/** One entry per restaurant with a public menu. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stores = await serverGet<{ slug: string; updatedAt: string }[]>('/public-directory', {
    tags: ['directory'],
    revalidate: 3600,
  }).catch(() => []);
  const origin = await requestOrigin();
  return stores.map((s) => ({
    url: `${origin}/${s.slug}`,
    lastModified: s.updatedAt,
    changeFrequency: 'daily',
  }));
}
