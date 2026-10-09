'use client';

import type * as React from 'react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

export { toast } from 'sonner';

export function Toaster(props: ToasterProps) {
  const { theme = 'system' } = useTheme();
  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      closeButton
      position="top-right"
      // Theme tokens instead of sonner's own palette: a colored 4 px bar per kind.
      toastOptions={{
        classNames: {
          toast: 'rounded-xl! border-l-4! font-sans! text-sm!',
          success: 'border-l-signal-positive! [&_[data-icon]]:text-signal-positive',
          error: 'border-l-signal-critical! [&_[data-icon]]:text-signal-critical',
          warning: 'border-l-signal-attention! [&_[data-icon]]:text-signal-attention',
          info: 'border-l-accent-blue! [&_[data-icon]]:text-accent-blue',
        },
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
