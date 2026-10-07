'use client';

import { formatBRL, onlyDigits } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { cn } from '@app/ui/lib/utils';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Currency input in cents ("1234" → "R$ 12,34"). */
export function MoneyInput({
  value,
  onChange,
  ...props
}: { value: number; onChange: (cents: number) => void } & Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange'
>) {
  return (
    <Input
      inputMode="numeric"
      {...props}
      className={cn('tabular', props.className)}
      value={formatBRL(value)}
      onChange={(e) => onChange(Number(onlyDigits(e.target.value) || '0'))}
      onFocus={(e) => e.target.select()}
    />
  );
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={`Diminuir ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span className="tabular w-7 text-center font-medium">{value}</span>
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={`Aumentar ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  );
}

/**
 * Current time, ticking. Open/closed on the page uses the device clock (the cached page may be
 * minutes old); the server checks the opening hours again when the order is placed.
 */
export function useNow(intervalMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
