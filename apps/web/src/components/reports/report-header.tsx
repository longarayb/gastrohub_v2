'use client';

import type { ReportScope } from '@app/shared';
import { cn } from '@app/ui/lib/utils';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth';

/** Page header of the dashboard and reports (docs/DESIGN.md): 34 px title, muted subtitle. */
export function ReportHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 font-display">
      <div className="min-w-0 space-y-1">
        <h1 className="text-display font-extrabold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground first-letter:uppercase">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

/** Segmented buttons of 44 px (periods, comparison, unit/network). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-xl border bg-card p-1"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-11 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring',
            o.value === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The owner of several units can see the whole network (D038); others only their unit. */
export function useNetworkAvailable(): boolean {
  const session = useSession();
  return (
    session.role === 'OWNER' && session.memberships.filter((m) => m.role === 'OWNER').length > 1
  );
}

export function ScopeSwitch({
  value,
  onChange,
}: {
  value: ReportScope;
  onChange: (scope: ReportScope) => void;
}) {
  const available = useNetworkAvailable();
  if (!available) return null;
  return (
    <Segmented
      label="Unidades"
      value={value}
      onChange={onChange}
      options={[
        { value: 'STORE', label: 'Esta unidade' },
        { value: 'NETWORK', label: 'Todas as unidades' },
      ]}
    />
  );
}
