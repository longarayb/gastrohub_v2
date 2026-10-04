import { BRAND } from '@app/shared';
import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

/** Favicon generated from BRAND (initial of the product name over the primary color). */
export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        background: BRAND.colors.primaryHex,
        color: '#ffffff',
        fontSize: 40,
        fontWeight: 700,
      }}
    >
      {BRAND.name.charAt(0).toUpperCase()}
    </div>,
    size,
  );
}
