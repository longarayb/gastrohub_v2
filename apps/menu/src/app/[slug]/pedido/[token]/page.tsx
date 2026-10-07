import type { PublicTrackingDto } from '@app/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TrackingView } from '@/components/tracking-view';
import { PublicApiError, serverGet } from '@/lib/api';

type Params = { params: Promise<{ slug: string; token: string }> };

// Personal tracking link: never indexed, never cached.
export const metadata: Metadata = {
  title: 'Acompanhe seu pedido',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function TrackingPage({ params }: Params) {
  const { slug, token } = await params;
  let order: PublicTrackingDto;
  try {
    order = await serverGet<PublicTrackingDto>(`/public/${slug}/orders/${token}`, 'no-store');
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 404) notFound();
    throw error;
  }
  return <TrackingView slug={slug} token={token} initial={order} />;
}
