import { ChefHat } from 'lucide-react';
import { cn } from '@gastrohub/ui/lib/utils';

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 font-semibold', className)}>
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <ChefHat className="size-5" />
      </span>
      {!compact && <span className="text-lg tracking-tight">GastroHub</span>}
    </div>
  );
}
