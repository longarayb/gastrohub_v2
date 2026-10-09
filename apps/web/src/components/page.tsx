import { cn } from '@app/ui/lib/utils';
import { BusinessDayLine } from './business-day';

/**
 * Standard page wrapper (docs/DESIGN.md, "Cabeçalho da página"): 34 px title (smaller on the
 * phone), muted subtitle (the description, or the date and business day when `dated`) and
 * the actions on the right.
 */
export function Page({
  title,
  description,
  dated = false,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Subtitle with the date and the business day (operation screens). */
  dated?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const subtitle = description ?? (dated ? <BusinessDayLine /> : null);
  return (
    <div className={cn('mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6 lg:p-8', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-3xl leading-tight font-extrabold tracking-tight md:text-display">
            {title}
          </h1>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed p-10 text-center">
      {Icon && <Icon className="size-10 text-muted-foreground" />}
      <div className="space-y-1">
        <p className="font-bold">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <span className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
