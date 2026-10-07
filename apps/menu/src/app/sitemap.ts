import type { MetadataRoute } from 'next';
import { MENU_URL, serverGet } from '@/lib/api';

export const revalidate = 3600;

/** One entry per restaurant with a public menu. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stores = await serverGet<{ slug: string; updatedAt: string }[]>('/public-directory', {
    tags: ['directory'],
    revalidate: 3600,
  }).catch(() => []);
  return stores.map((s) => ({
    url: `${MENU_URL}/${s.slug}`,
    lastModified: s.updatedAt,
    changeFrequency: 'daily',
  }));
}
