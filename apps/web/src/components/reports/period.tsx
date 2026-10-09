'use client';

import type { ReportKind } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@app/ui/components/dropdown-menu';
import { Input } from '@app/ui/components/input';
import { toast } from '@app/ui/components/sonner';
import { Download, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '@/lib/api';
import { PERIODS, type PeriodId, downloadCsv, periodRange } from '@/lib/reports';
import { useBusinessToday } from '@/lib/stores';
import { Segmented } from './report-header';

export { useBusinessToday };

export interface PeriodState {
  id: PeriodId;
  from: string;
  to: string;
}

/** Period chosen on a report page (presets ending today, months, or custom dates). */
export function usePeriod(initial: PeriodId = '30d') {
  const today = useBusinessToday();
  const [id, setId] = useState<PeriodId>(initial);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const range = useMemo(() => {
    if (!today) return null;
    if (id === 'custom' && custom) return custom;
    return periodRange(id, today);
  }, [id, custom, today]);
  return { id, setId, range, today, custom, setCustom };
}

const OPTIONS: { value: PeriodId; label: string }[] = [
  ...PERIODS.map((p) => ({ value: p.id as PeriodId, label: p.label })),
  { value: 'month', label: 'Este mês' },
  { value: 'lastMonth', label: 'Mês anterior' },
  { value: 'custom', label: 'Outro' },
];

export function PeriodPicker({
  period,
  maxDays,
}: {
  period: ReturnType<typeof usePeriod>;
  /** Longest period accepted by the report (times: 120 days). */
  maxDays?: number;
}) {
  const options = maxDays
    ? OPTIONS.filter((o) => o.value !== 'lastMonth' || maxDays >= 31)
    : OPTIONS;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="Período"
        value={period.id}
        options={options}
        onChange={(id) => {
          if (id === 'custom' && period.range) period.setCustom(period.range);
          period.setId(id);
        }}
      />
      {period.id === 'custom' && period.custom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label="De"
            className="h-11 w-40"
            value={period.custom.from}
            max={period.custom.to}
            onChange={(e) =>
              e.target.value && period.setCustom({ ...period.custom!, from: e.target.value })
            }
          />
          <span className="text-sm text-muted-foreground">a</span>
          <Input
            type="date"
            aria-label="Até"
            className="h-11 w-40"
            value={period.custom.to}
            min={period.custom.from}
            max={period.today ?? undefined}
            onChange={(e) =>
              e.target.value && period.setCustom({ ...period.custom!, to: e.target.value })
            }
          />
        </div>
      )}
    </div>
  );
}

/** CSV of a report section (Excel pt-BR) and A4 printing. */
export function ReportTools({
  report,
  sections,
  range,
  onPrint,
}: {
  report: ReportKind;
  sections: { id: string; label: string }[];
  range: { from: string; to: string };
  onPrint: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function download(section: string) {
    setBusy(true);
    try {
      await downloadCsv(report, section, range.from, range.to);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-11" loading={busy}>
            <Download /> Exportar CSV
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {sections.map((s) => (
            <DropdownMenuItem key={s.id} className="min-h-11" onSelect={() => void download(s.id)}>
              {s.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="outline" className="h-11" onClick={onPrint}>
        <Printer /> Imprimir
      </Button>
    </>
  );
}
