'use client';

import * as React from 'react';
import {
  Separator as SeparatorPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
  Tooltip as TooltipPrimitive,
} from 'radix-ui';
import { cn } from '../lib/utils';

/* ---------- Separator ---------- */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div aria-hidden className={cn('animate-pulse rounded-lg bg-track', className)} {...props} />
  );
}

/* ---------- Switch ---------- */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-background ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%)] data-[state=unchecked]:translate-x-0.5" />
    </SwitchPrimitive.Root>
  );
}

/* ---------- Tabs ---------- */
export const Tabs = ({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) => (
  <TabsPrimitive.Root className={cn('flex flex-col gap-2', className)} {...props} />
);

export const TabsList = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      'inline-flex h-11 w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg border bg-muted p-1 text-muted-foreground',
      className,
    )}
    {...props}
  />
);

/**
 * Our tabs mostly filter or choose (order type, kanban filter) without a TabsContent panel, so
 * Radix's `aria-controls` would point to nothing (axe: invalid ARIA). It is only set when the
 * caller passes it, with the id of the panel.
 */
export const TabsTrigger = ({
  className,
  'aria-controls': controls,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    aria-controls={controls}
    className={cn(
      // Muted text on the track; the active tab is a card with full-contrast bold text.
      "relative inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:text-foreground focus-visible:outline-offset-0 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs",
      className,
    )}
    {...props}
  />
);

export const TabsContent = ({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('flex-1 outline-none', className)} {...props} />
);

/* ---------- Tooltip ---------- */
export const TooltipProvider = ({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
);
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-fit animate-in rounded-md bg-foreground px-3 py-1.5 text-xs text-balance text-background fade-in-0 zoom-in-95',
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn(
        'inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}
