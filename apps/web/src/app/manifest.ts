import { BRAND } from '@app/shared';
import type { MetadataRoute } from 'next';

/**
 * Installable panel (D049): the courier adds it to the home screen (on the iPhone, Web Push only
 * works that way). Opens at the role's home page (the courier lands on /entregas).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.tagline,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0b111c',
    theme_color: BRAND.colors.primaryHex,
    icons: [{ src: BRAND.favicon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
