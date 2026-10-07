import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { storeTag } from '@/lib/api';

/**
 * Called by the API after a restaurant changes its menu, store data or delivery areas: refreshes
 * the cached pages of that restaurant. Protected by a shared secret (MENU_REVALIDATE_SECRET).
 */
export async function POST(request: Request) {
  const secret = process.env.MENU_REVALIDATE_SECRET;
  if (!secret || request.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ message: 'Não autorizado' }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { slug?: unknown };
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!/^[a-z0-9-]{2,80}$/.test(slug)) {
    return NextResponse.json({ message: 'Slug inválido' }, { status: 400 });
  }
  revalidateTag(storeTag(slug), { expire: 0 });
  revalidatePath(`/${slug}`);
  return NextResponse.json({ revalidated: true });
}
