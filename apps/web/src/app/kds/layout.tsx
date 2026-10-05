import type { Metadata } from 'next';
import { KdsSessionProvider } from '@/lib/kds-session';

export const metadata: Metadata = { title: 'Cozinha' };

/**
 * Kitchen display (D027–D028): its own layout, without the admin shell. Dark by default
 * (the `.dark` tokens apply to this subtree); a paired device or a signed-in user.
 */
export default function KdsLayout({ children }: { children: React.ReactNode }) {
  return (
    <KdsSessionProvider>
      <div className="dark min-h-dvh bg-background text-foreground">{children}</div>
    </KdsSessionProvider>
  );
}
