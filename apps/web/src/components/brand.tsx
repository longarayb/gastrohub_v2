import { BRAND } from '@app/shared';
import { cn } from '@app/ui/lib/utils';
import { ChefHat } from 'lucide-react';

/** Product logo + name, both taken from BRAND (@app/shared). */
export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 font-semibold', className)}>
      {BRAND.logo.src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={BRAND.logo.src} alt="" className="size-8 rounded-lg object-contain" />
      ) : (
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ChefHat className="size-5" />
        </span>
      )}
      {!compact && <span className="text-lg tracking-tight">{BRAND.name}</span>}
    </div>
  );
}
