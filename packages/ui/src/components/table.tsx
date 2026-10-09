import * as React from 'react';
import { cn } from '../lib/utils';

/**
 * Data table. `stack`: below 768 px every row becomes a card and each cell shows its
 * column name (`TableCell label`), so the phone never scrolls sideways (docs/DESIGN.md).
 */
export function Table({
  className,
  stack = false,
  ...props
}: React.ComponentProps<'table'> & { stack?: boolean }) {
  return (
    <div
      className={cn('relative w-full', !stack && 'overflow-x-auto', stack && 'md:overflow-x-auto')}
    >
      <table
        data-stack={stack || undefined}
        className={cn('group/table w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      className={cn('group-data-stack/table:max-md:sr-only [&_tr]:border-b', className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      className={cn(
        'group-data-stack/table:max-md:flex group-data-stack/table:max-md:flex-col group-data-stack/table:max-md:gap-3 group-data-stack/table:max-md:p-3 [&_tr:last-child]:border-0',
        className,
      )}
      {...props}
    />
  );
}

export function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      className={cn('border-t bg-muted/50 font-bold [&>tr]:last:border-b-0', className)}
      {...props}
    />
  );
}

export function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-accent/50 data-[state=selected]:bg-accent',
        'group-data-stack/table:max-md:flex group-data-stack/table:max-md:flex-col group-data-stack/table:max-md:rounded-lg group-data-stack/table:max-md:border group-data-stack/table:max-md:bg-card group-data-stack/table:max-md:p-3',
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'h-11 px-3 text-left align-middle text-xs font-bold tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  label,
  ...props
}: React.ComponentProps<'td'> & {
  /** Column name shown before the value when the table is stacked (phone). */
  label?: string;
}) {
  return (
    <td
      data-label={label}
      className={cn(
        'px-3 py-2.5 align-middle whitespace-nowrap',
        'group-data-stack/table:max-md:flex group-data-stack/table:max-md:min-h-9 group-data-stack/table:max-md:items-center group-data-stack/table:max-md:justify-between group-data-stack/table:max-md:gap-3 group-data-stack/table:max-md:px-0 group-data-stack/table:max-md:py-1 group-data-stack/table:max-md:whitespace-normal',
        label &&
          'group-data-stack/table:max-md:before:text-xs group-data-stack/table:max-md:before:font-bold group-data-stack/table:max-md:before:text-muted-foreground group-data-stack/table:max-md:before:uppercase group-data-stack/table:max-md:before:content-[attr(data-label)]',
        className,
      )}
      {...props}
    />
  );
}
