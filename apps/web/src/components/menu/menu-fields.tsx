'use client';

import {
  type BusinessHour,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  type SalesChannel,
  WEEKDAY_LABELS,
  isPausedNow,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@app/ui/components/dropdown-menu';
import { Input } from '@app/ui/components/input';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { CircleOff, Copy, PauseCircle, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { type PauseTarget, pauseItem, resumeItem, useInvalidateMenu } from '@/lib/menu';

// ---------------------------------------------------------------------------
// Opening hours / sale windows editor (also used by the store hours page)

export function ScheduleEditor({
  value,
  onChange,
  emptyLabel = 'Fechado',
}: {
  value: BusinessHour[];
  onChange: (value: BusinessHour[]) => void;
  emptyLabel?: string;
}) {
  const update = (index: number, patch: Partial<BusinessHour>) =>
    onChange(value.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  const add = (weekday: number) =>
    onChange([...value, { weekday, opensAt: '18:00', closesAt: '23:00' }]);
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const copyToAll = (weekday: number) => {
    const source = value.filter((h) => h.weekday === weekday);
    onChange(WEEKDAY_LABELS.flatMap((_, day) => source.map((h) => ({ ...h, weekday: day }))));
  };

  return (
    <div className="divide-y">
      {WEEKDAY_LABELS.map((label, weekday) => {
        const shifts = value
          .map((h, index) => ({ ...h, index }))
          .filter((h) => h.weekday === weekday);
        return (
          <div key={label} className="flex flex-col gap-3 py-3 md:flex-row md:items-start">
            <div className="w-36 shrink-0 pt-2 text-sm font-medium">{label}</div>
            <div className="flex flex-1 flex-col gap-2">
              {shifts.length === 0 && (
                <p className="pt-2 text-sm text-muted-foreground">{emptyLabel}</p>
              )}
              {shifts.map((shift) => (
                <div key={shift.index} className="flex items-center gap-2">
                  <Input
                    type="time"
                    className="w-32"
                    value={shift.opensAt}
                    onChange={(e) => update(shift.index, { opensAt: e.target.value })}
                    aria-label={`${label}: início`}
                  />
                  <span className="text-sm text-muted-foreground">até</span>
                  <Input
                    type="time"
                    className="w-32"
                    value={shift.closesAt}
                    onChange={(e) => update(shift.index, { closesAt: e.target.value })}
                    aria-label={`${label}: fim`}
                  />
                  {shift.closesAt <= shift.opensAt && shift.closesAt !== shift.opensAt && (
                    <span className="text-xs text-muted-foreground">(termina no dia seguinte)</span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(shift.index)}
                    aria-label="Remover horário"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => add(weekday)}>
                <Plus /> Horário
              </Button>
              {shifts.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => copyToAll(weekday)}>
                  <Copy /> Copiar para todos
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sales channels

export function ChannelsField({
  value,
  onChange,
  error,
}: {
  value: SalesChannel[];
  onChange: (value: SalesChannel[]) => void;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {SALES_CHANNELS.map((channel) => (
          <label key={channel} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={value.includes(channel)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? SALES_CHANNELS.filter((c) => c === channel || value.includes(c))
                    : value.filter((c) => c !== channel),
                )
              }
            />
            {SALES_CHANNEL_LABELS[channel]}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function ChannelBadges({ channels }: { channels: SalesChannel[] }) {
  if (channels.length === SALES_CHANNELS.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {channels.map((c) => (
        <Badge key={c} variant="outline" className="text-[10px]">
          {SALES_CHANNEL_LABELS[c]}
        </Badge>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pause ("Acabou")

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export function PauseBadge({ item }: { item: { isPaused: boolean; pausedUntil: string | null } }) {
  if (!isPausedNow(item)) return null;
  return (
    <Badge variant="warning" className="whitespace-nowrap">
      <CircleOff />
      {item.pausedUntil
        ? `Pausado até ${timeFormatter.format(new Date(item.pausedUntil))}`
        : 'Pausado'}
    </Badge>
  );
}

/**
 * One-click "Acabou" (until the end of the business day) with a menu for indefinite
 * pause and resume.
 */
export function PauseButton({
  target,
  item,
  label = 'Acabou',
  size = 'sm',
  className,
  onChanged,
}: {
  target: PauseTarget;
  item: { isPaused: boolean; pausedUntil: string | null };
  label?: string;
  size?: 'sm' | 'default';
  className?: string;
  onChanged?: () => void;
}) {
  const invalidate = useInvalidateMenu();
  const [busy, setBusy] = useState(false);
  const paused = isPausedNow(item);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      await invalidate();
      onChanged?.();
      toast.success(message);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (paused) {
    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        loading={busy}
        className={className}
        onClick={() => run(() => resumeItem(target), 'Disponível novamente')}
      >
        <Play /> Reativar
      </Button>
    );
  }

  return (
    <div className={cn('flex', className)}>
      <Button
        type="button"
        variant="outline"
        size={size}
        loading={busy}
        className="rounded-r-none"
        onClick={() => run(() => pauseItem(target, 'END_OF_DAY'), 'Pausado até o fim do dia')}
      >
        <PauseCircle /> {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size={size === 'sm' ? 'icon-sm' : 'icon'}
            className="rounded-l-none border-l-0"
            aria-label="Mais opções de pausa"
          >
            <span aria-hidden>▾</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Pausar</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => run(() => pauseItem(target, 'END_OF_DAY'), 'Pausado até o fim do dia')}
          >
            Até o fim do dia (acabou)
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => run(() => pauseItem(target, 'INDEFINITE'), 'Pausado até reativar')}
          >
            Até eu reativar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
