import type { CatalogDto, PublicStoreDto } from '@app/shared';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PublicApiError, serverGet, storeTag } from '@/lib/api';

/** Pages are cached and refreshed by the API on menu changes; this is the safety net. */
export const MENU_REVALIDATE_SECONDS = 300;

const cached = (slug: string) => ({
  tags: [storeTag(slug)],
  revalidate: MENU_REVALIDATE_SECONDS,
});

async function orNotFound<T>(slug: string, load: () => Promise<T>): Promise<T> {
  // "/favicon.ico" and other non-slugs never reach the API.
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) notFound();
  try {
    return await load();
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
}

/** The restaurant (deduplicated per request: layout, page and metadata share it). */
export const getStore = cache((slug: string) =>
  orNotFound(slug, () => serverGet<PublicStoreDto>(`/public/${slug}`, cached(slug))),
);

export const getCatalog = cache((slug: string) =>
  orNotFound(slug, () => serverGet<CatalogDto>(`/public/${slug}/catalog`, cached(slug))),
);
