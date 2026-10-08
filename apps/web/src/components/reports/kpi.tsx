'use client';

import { type Comparison, REPORT_HELP, type ReportHelpKey } from '@app/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@app/ui/components/popover';
import { cn } from '@app/ui/lib/utils';
import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

/** Semantic colors of the cards (docs/DESIGN.md), as static classes for the theme tokens. */
export const TONES = {
  blue: { stripe: 'border-l-accent-blue', text: 'text-accent-blue', bar: 'bg-accent-blue' },
  green: { stripe: 'border-l-accent-green', text: 'text-accent-green', bar: 'bg-accent-green' },
  purple: { stripe: 'border-l-accent-purple', text: 'text-accent-purple', bar: 'bg-accent-purple' },
  orange: { stripe: 'border-l-accent-orange', text: 'text-accent-orange', bar: 'bg-accent-orange' },
  attention: {
    stripe: 'border-l-signal-attention',
    text: 'text-signal-attention',
    bar: 'bg-signal-attention',
  },
  critical: {
    stripe: 'border-l-signal-critical',
    text: 'text-signal-critical',
    bar: 'bg-signal-critical',
  },
  positive: {
    stripe: 'border-l-signal-positive',
    text: 'text-signal-positive',
    bar: 'bg-signal-positive',
  },
} as const;
export type Tone = keyof typeof TONES;

/** ⓘ with the definition of an indicator (D038); opens on tap. */
export function HelpTip({ topic, label }: { topic: ReportHelpKey; label: string }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`O que é ${label}?`}
        className="-m-3 inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Info className="size-4" />
      </PopoverTrigger>
      <PopoverContent>
        <p className="font-semibold">{label}</p>
        <p className="mt-1 text-muted-foreground">{REPORT_HELP[topic]}</p>
      </PopoverContent>
    </Popover>
  );
}

/** "▲ 12,5% vs. terça passada" — green when it improves, red when it gets worse. */
export function ComparisonLine({
  comparison,
  against,
}: {
  comparison: Comparison;
  against: string;
}) {
  if (comparison.deltaPct === null) {
    return <span className="text-muted-foreground">sem base de comparação</span>;
  }
  const color =
    comparison.trend === 'better'
      ? 'text-signal-positive'
      : comparison.trend === 'worse'
        ? 'text-signal-critical'
        : 'text-muted-foreground';
  const arrow = comparison.delta > 0 ? '▲' : comparison.delta < 0 ? '▼' : '=';
  const word =
    comparison.trend === 'better' ? 'melhor' : comparison.trend === 'worse' ? 'pior' : 'igual';
  return (
    <span className={cn('tabular font-semibold', color)}>
      <span aria-hidden>{arrow} </span>
      {Math.abs(comparison.deltaPct).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
      <span className="sr-only"> ({word})</span>{' '}
      <span className="font-normal text-muted-foreground">vs. {against}</span>
    </span>
  );
}

export function KpiCard({
  label,
  value,
  support,
  comparison,
  tone,
  help,
  action,
}: {
  label: string;
  value: ReactNode;
  support?: ReactNode;
  comparison?: ReactNode;
  tone: Tone;
  help?: ReportHelpKey;
  /** Small control in the header (e.g. "Total / Só produtos"). */
  action?: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        'flex min-w-0 flex-[1_1_230px] flex-col gap-1 rounded-card border border-l-4 bg-card p-4 font-display text-card-foreground',
        TONES[tone].stripe,
      )}
    >
      {/* Same header height in every card (the ticket card has a 44 px toggle). */}
      <div className="flex min-h-11 items-center gap-2">
        <h2 className="text-kpi-label font-bold tracking-[0.1em] text-muted-foreground uppercase">
          {label}
        </h2>
        {help && <HelpTip topic={help} label={label} />}
        <div className="flex-1" />
        {action}
      </div>
      <p className="tabular text-kpi font-extrabold break-words">{value}</p>
      {support && <p className="text-sm text-muted-foreground">{support}</p>}
      {comparison && <p className="text-sm">{comparison}</p>}
    </section>
  );
}

/** Cards side by side; the last of a row grows to fill it (no gap left by a lone card). */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-4">{children}</div>;
}

/** Report card with title, summary on the right and content (BarList, charts). */
export function ReportCard({
  title,
  summary,
  help,
  actions,
  children,
  className,
}: {
  title: string;
  summary?: ReactNode;
  help?: ReportHelpKey;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        'min-w-0 rounded-card border bg-card p-4 font-display text-card-foreground md:p-5',
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold">{title}</h2>
        {help && <HelpTip topic={help} label={title} />}
        <div className="flex-1" />
        {summary && <p className="tabular text-sm text-muted-foreground">{summary}</p>}
        {actions}
      </header>
      {children}
    </section>
  );
}
