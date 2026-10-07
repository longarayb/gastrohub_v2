'use client';

import { Toaster } from '@app/ui/components/sonner';

/** Light on purpose: the menu runs on simple phones (no data cache library, no theme switch). */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" />
    </>
  );
}
