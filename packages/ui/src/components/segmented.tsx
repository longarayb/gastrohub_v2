import { cn } from '../lib/utils';

/**
 * Segmented buttons of 44 px (periods, comparison, unit/network): a radio group, the chosen
 * one in the brand color (docs/DESIGN.md, "Cabeçalho da página").
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex flex-wrap gap-1 rounded-xl border bg-card p-1', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-11 rounded-lg px-4 text-sm font-semibold transition-colors focus-visible:outline-offset-0',
            o.value === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
