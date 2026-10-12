import { BRAND } from '@app/shared';
import { cn } from '@app/ui/lib/utils';
import { ChefHat } from 'lucide-react';

/** Product logo alone (BRAND.logo, or the default icon mark). */
export function BrandMark({ className }: { className?: string }) {
  return BRAND.logo.src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND.logo.src}
      alt=""
      className={cn('size-8 shrink-0 rounded-lg object-contain', className)}
    />
  ) : (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground',
        className,
      )}
    >
      <ChefHat className="size-1/2" />
    </span>
  );
}

/** Product logo + name, both taken from BRAND (@app/shared). */
export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 font-extrabold', className)}>
      <BrandMark />
      {!compact && <span className="text-lg tracking-tight">{BRAND.name}</span>}
    </div>
  );
}
