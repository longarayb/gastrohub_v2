import { readableForeground } from '@app/shared';
import { ImageResponse } from 'next/og';
import { storeThemeColor } from '@/lib/theme';
import { getStore } from './data';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Cardápio do restaurante';

/** Link preview (WhatsApp, Instagram, Facebook): the restaurant's name, color, logo and cover. */
export default async function OpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const store = await getStore(slug);
  const background = storeThemeColor(store.brandColor);
  const color = readableForeground(background);
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background,
        color,
        fontFamily: 'sans-serif',
      }}
    >
      {store.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og
        <img
          src={store.coverUrl}
          alt=""
          width={1200}
          height={630}
          style={{ position: 'absolute', inset: 0, objectFit: 'cover', opacity: 0.35 }}
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 28,
          padding: 80,
          position: 'relative',
        }}
      >
        {store.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- rendered to PNG by next/og
          <img
            src={store.logoUrl}
            alt=""
            width={140}
            height={140}
            style={{ borderRadius: 28, objectFit: 'cover', background: '#ffffff' }}
          />
        )}
        <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{store.name}</div>
        <div style={{ fontSize: 36, opacity: 0.9, maxWidth: 950 }}>
          {store.description ?? 'Veja o cardápio e peça online'}
        </div>
        <div style={{ fontSize: 30, fontWeight: 700 }}>
          {store.delivers
            ? 'Entrega e retirada · peça pelo celular'
            : 'Retirada · peça pelo celular'}
        </div>
      </div>
    </div>,
    size,
  );
}
