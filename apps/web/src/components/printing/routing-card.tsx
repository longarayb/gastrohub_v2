'use client';

import {
  DEFAULT_PRINT_HOLD_MINUTES,
  MAX_PRINT_COPIES,
  type PrintSettingsDto,
  type PrinterDto,
  type SectorPrinterDto,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { Switch } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Field } from '@/components/form';
import { errorMessage } from '@/lib/api';
import { printKeys, updatePrintSettings, updateSectorPrinters } from '@/lib/printing';

const NONE = 'none';
const COPIES = Array.from({ length: MAX_PRINT_COPIES }, (_, i) => i + 1);

function PrinterSelect({
  value,
  printers,
  onChange,
  label,
  noneLabel,
}: {
  value: string | null;
  printers: PrinterDto[];
  onChange: (id: string | null) => void;
  label: string;
  noneLabel: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger aria-label={label} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {printers.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name} ({p.agentName})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CopiesSelect({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label={label} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COPIES.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n} {n === 1 ? 'via' : 'vias'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Where each production sector prints its tickets, and how many copies (D036). */
export function SectorRoutingCard({
  sectors,
  printers,
}: {
  sectors: SectorPrinterDto[];
  printers: PrinterDto[];
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(sectors);
  const [busy, setBusy] = useState(false);
  const changed = JSON.stringify(rows) !== JSON.stringify(sectors);
  const usable = printers.filter((p) => p.active);
  const set = (id: string, patch: Partial<SectorPrinterDto>) =>
    setRows((list) => list.map((r) => (r.sectorId === id ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    try {
      await updateSectorPrinters({
        sectors: rows.map((r) => ({
          sectorId: r.sectorId,
          printerId: r.printerId,
          copies: r.copies,
        })),
      });
      await queryClient.invalidateQueries({ queryKey: printKeys.all });
      toast.success('Impressão por setor salva');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comandas por setor</CardTitle>
        <CardDescription>
          Cada setor recebe a sua comanda quando o pedido é aceito e a cada rodada enviada. Itens
          cancelados depois de impressos geram um aviso &quot;CANCELADO&quot; no setor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">
            Crie os setores em Cardápio › Setores de produção.
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {rows.map((r) => (
              <li key={r.sectorId} className="flex flex-wrap items-center gap-3 p-3">
                <span className="min-w-32 flex-1 font-medium">{r.name}</span>
                <PrinterSelect
                  value={r.printerId}
                  printers={usable}
                  label={`Impressora de ${r.name}`}
                  noneLabel="Não imprimir"
                  onChange={(printerId) => set(r.sectorId, { printerId })}
                />
                <CopiesSelect
                  value={r.copies}
                  label={`Vias de ${r.name}`}
                  onChange={(copies) => set(r.sectorId, { copies })}
                />
              </li>
            ))}
          </ul>
        )}
        {changed && (
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={busy}>
              Salvar setores
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Cash printer, delivery copy, cancel slips and how long a job waits before being held. */
export function PrintSettingsCard({
  settings,
  printers,
}: {
  settings: PrintSettingsDto;
  printers: PrinterDto[];
}) {
  const queryClient = useQueryClient();
  const holdId = useId();
  const [form, setForm] = useState(settings);
  const [hold, setHold] = useState(String(settings.holdAfterMinutes));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PrintSettingsDto>) => setForm((f) => ({ ...f, ...patch }));
  const changed =
    JSON.stringify(form) !== JSON.stringify(settings) || Number(hold) !== settings.holdAfterMinutes;

  async function save() {
    setBusy(true);
    try {
      await updatePrintSettings({
        ...form,
        holdAfterMinutes: Number(hold) || DEFAULT_PRINT_HOLD_MINUTES,
      });
      await queryClient.invalidateQueries({ queryKey: printKeys.all });
      toast.success('Configuração salva');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Caixa e entregas</CardTitle>
        <CardDescription>
          A impressora do caixa recebe a pré-conta, a via de entrega, o fechamento de caixa e o
          acerto dos entregadores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Field label="Impressora do caixa">
          <PrinterSelect
            value={form.cashPrinterId}
            printers={printers.filter((p) => p.active)}
            label="Impressora do caixa"
            noneLabel="Nenhuma (imprimir pelo navegador)"
            onChange={(cashPrinterId) => set({ cashPrinterId })}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="flex items-center gap-3 font-normal">
            <Switch
              checked={form.deliveryCopyOnAccept}
              onCheckedChange={(deliveryCopyOnAccept) => set({ deliveryCopyOnAccept })}
            />
            Imprimir a via de entrega ao aceitar um delivery
          </Label>
          {form.deliveryCopyOnAccept && (
            <CopiesSelect
              value={form.deliveryCopies}
              label="Vias de entrega"
              onChange={(deliveryCopies) => set({ deliveryCopies })}
            />
          )}
        </div>
        <Label className="flex items-center gap-3 font-normal">
          <Switch
            checked={form.cancelSlips}
            onCheckedChange={(cancelSlips) => set({ cancelSlips })}
          />
          Avisar o setor com &quot;CANCELADO&quot; quando um item já impresso for cancelado
        </Label>
        <Field
          label="Segurar impressões atrasadas depois de (minutos)"
          htmlFor={holdId}
          hint="Se o computador ficar desligado, o que tiver mais tempo do que isso espera alguém decidir entre imprimir e descartar. O que tiver menos sai marcado como atrasado."
        >
          <Input
            id={holdId}
            type="number"
            min={5}
            max={240}
            value={hold}
            className="w-28"
            onChange={(e) => setHold(e.target.value)}
          />
        </Field>
        {changed && (
          <div className="flex justify-end">
            <Button onClick={() => void save()} loading={busy}>
              Salvar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
