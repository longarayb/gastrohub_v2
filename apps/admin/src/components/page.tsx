import { PageHeader } from '@app/ui/components/states';
import { cn } from '@app/ui/lib/utils';

export { EmptyState } from '@app/ui/components/states';

/**
 * Standard page wrapper (docs/DESIGN.md, "Cabeçalho da página"): 34 px title (smaller on the
 * phone), muted subtitle (the description, or the date and business day when `dated`) and
 * the actions on the right.
 */
export function Page({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6 lg:p-8', className)}>
      <PageHeader title={title} subtitle={description ?? null} actions={actions} />
      {children}
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <div
      className="flex min-h-dvh items-center justify-center"
      role="status"
      aria-label="Carregando"
    >
      <span className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}
