import type * as React from 'react';
import { cn } from '../lib/utils';
import { Skeleton, Spinner } from './misc';

/** Nothing to show yet: icon, title, a line of help and an optional action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-card border border-dashed p-10 text-center',
        className,
      )}
    >
      {Icon && <Icon className="size-10 text-muted-foreground" />}
      <div className="space-y-1">
        <p className="font-bold">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Placeholder rows while a list loads (same height as the rows, no layout jump). */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('grid gap-2', className)} aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}

/** Centered spinner for a whole area (prefer skeletons where the layout is known). */
export function LoadingArea({
  label = 'Carregando',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center justify-center gap-3 p-10 text-muted-foreground', className)}
    >
      <Spinner />
      <span>{label}…</span>
    </div>
  );
}

/** Page header (docs/DESIGN.md): 34 px title (smaller on the phone), muted subtitle, actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-3xl leading-tight font-extrabold tracking-tight md:text-display">
          {title}
        </h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

/** Keyboard shortcut hint ("F2", "Ctrl+K"). */
export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 bg-muted px-1.5 font-sans text-xs font-bold text-muted-foreground',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/**
 * Shortcuts of a screen, with what each key does HERE ("F9 Criar pedido"). Keyboard only:
 * hidden on touch screens. The full map opens with "?" (docs/DESIGN.md).
 */
export function ShortcutBar({
  items,
  className,
}: {
  items: readonly (readonly [string, string])[];
  className?: string;
}) {
  return (
    <p
      className={cn(
        'hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pointer-fine:flex',
        className,
      )}
      aria-label="Atalhos de teclado"
    >
      {items.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <Kbd>{key}</Kbd> {label}
        </span>
      ))}
    </p>
  );
}
