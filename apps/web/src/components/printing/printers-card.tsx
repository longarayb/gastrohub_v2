'use client';

import {
  PAPER_WIDTHS,
  PRINTER_CONNECTIONS,
  PRINTER_CONNECTION_LABELS,
  PRINTER_PROFILES,
  PRINTER_STATUS_LABELS,
  type PrintAgentDto,
  type PrinterConnection,
  type PrinterDto,
  type PrinterInput,
  printerProfile,
  printerSchema,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
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
import { Pencil, Plus, Printer, ScrollText, Trash2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { errorMessage } from '@/lib/api';
import {
  createPrinter,
  printKeys,
  removePrinter,
  testPrinter,
  updatePrinter,
} from '@/lib/printing';

const ADDRESS_HINTS: Record<PrinterConnection, string> = {
  NETWORK:
    'IP da impressora (ex.: 192.168.0.50). Ela imprime o IP ao ligar segurando o botão de avanço.',
  USB: 'Impressora instalada no Windows deste computador.',
  SHARED: 'Caminho da impressora compartilhada em outro computador (ex.: \\\\PC-CAIXA\\Cozinha).',
  VIRTUAL: 'Salva as impressões em arquivos no computador (para testes e demonstrações).',
};

const STATUS_VARIANT = {
  OK: 'success',
  UNKNOWN: 'secondary',
  PAPER_OUT: 'warning',
  OFFLINE: 'destructive',
  ERROR: 'destructive',
} as const;

function PrinterDialog({
  printer,
  agents,
  open,
  onOpenChange,
}: {
  printer: PrinterDto | null;
  agents: PrintAgentDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ids = { name: useId(), address: useId() };
  const empty: PrinterInput = {
    name: '',
    agentId: agents[0]?.id ?? '',
    connection: 'NETWORK',
    address: '',
    profileId: PRINTER_PROFILES[0]!.id,
    paperWidth: 80,
    withoutAccents: false,
    active: true,
  };
  const [form, setForm] = useState<PrinterInput>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<PrinterInput>) => setForm((f) => ({ ...f, ...patch }));
  const agent = agents.find((a) => a.id === form.agentId);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      printer
        ? {
            name: printer.name,
            agentId: printer.agentId,
            connection: printer.connection,
            address: printer.address,
            profileId: printer.profileId,
            paperWidth: printer.paperWidth,
            withoutAccents: printer.withoutAccents,
            active: printer.active,
          }
        : empty,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when (re)opened
  }, [open, printer]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = printerSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    try {
      if (printer) await updatePrinter(printer.id, form);
      else await createPrinter(form);
      toast.success(printer ? 'Impressora atualizada' : 'Impressora cadastrada. Faça um teste.');
      await queryClient.invalidateQueries({ queryKey: printKeys.all });
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const profile = printerProfile(form.profileId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{printer ? `Editar ${printer.name}` : 'Nova impressora'}</DialogTitle>
            <DialogDescription>Impressora térmica de cupom (58 ou 80 mm).</DialogDescription>
          </DialogHeader>
          <Field label="Nome" htmlFor={ids.name} error={errors.name}>
            <Input
              id={ids.name}
              value={form.name}
              maxLength={60}
              placeholder="Ex.: Cozinha"
              onChange={(e) => set({ name: e.target.value })}
            />
          </Field>
          <Field label="Computador ligado a ela" error={errors.agentId}>
            <Select value={form.agentId} onValueChange={(agentId) => set({ agentId })}>
              <SelectTrigger aria-label="Computador">
                <SelectValue placeholder="Escolha o computador" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Como está ligada">
            <Select
              value={form.connection}
              onValueChange={(connection) =>
                set({ connection: connection as PrinterConnection, address: '' })
              }
            >
              <SelectTrigger aria-label="Conexão">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRINTER_CONNECTIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {PRINTER_CONNECTION_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.connection !== 'VIRTUAL' && (
            <Field
              label={form.connection === 'USB' ? 'Impressora no Windows' : 'Endereço'}
              htmlFor={ids.address}
              error={errors.address}
            >
              {form.connection === 'USB' && agent?.windowsPrinters.length ? (
                <Select value={form.address} onValueChange={(address) => set({ address })}>
                  <SelectTrigger id={ids.address} aria-label="Impressora no Windows">
                    <SelectValue placeholder="Escolha a impressora" />
                  </SelectTrigger>
                  <SelectContent>
                    {agent.windowsPrinters.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={ids.address}
                  value={form.address}
                  onChange={(e) => set({ address: e.target.value })}
                  placeholder={form.connection === 'NETWORK' ? '192.168.0.50' : ''}
                />
              )}
            </Field>
          )}
          <p className="-mt-2 text-xs text-muted-foreground">{ADDRESS_HINTS[form.connection]}</p>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Marca e modelo">
              <Select value={form.profileId} onValueChange={(profileId) => set({ profileId })}>
                <SelectTrigger aria-label="Marca e modelo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRINTER_PROFILES.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.brand} {p.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Papel">
              <Select
                value={String(form.paperWidth)}
                onValueChange={(w) => set({ paperWidth: Number(w) as 58 | 80 })}
              >
                <SelectTrigger aria-label="Largura do papel" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAPER_WIDTHS.map((w) => (
                    <SelectItem key={w} value={String(w)}>
                      {w} mm
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          {profile.note && <p className="-mt-2 text-xs text-muted-foreground">{profile.note}</p>}
          <Label className="flex items-start gap-3 font-normal">
            <Switch
              checked={form.withoutAccents}
              onCheckedChange={(withoutAccents) => set({ withoutAccents })}
            />
            <span>
              Imprimir sem acentos
              <span className="block text-xs text-muted-foreground">
                Último recurso, se a página de teste sair com caracteres errados em todos os
                modelos.
              </span>
            </span>
          </Label>
          {printer && (
            <Label className="flex items-center gap-3 font-normal">
              <Switch checked={form.active} onCheckedChange={(active) => set({ active })} />
              Em uso
            </Label>
          )}
          <DialogFooter>
            <Button type="submit" loading={busy}>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PrintersCard({
  printers,
  agents,
}: {
  printers: PrinterDto[];
  agents: PrintAgentDto[];
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PrinterDto | 'new' | null>(null);
  const [removing, setRemoving] = useState<PrinterDto | null>(null);
  const paired = agents.filter((a) => a.state !== 'REVOKED');

  async function test(printer: PrinterDto) {
    try {
      await testPrinter(printer.id);
      toast.success(`Página de teste enviada para ${printer.name}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Impressoras</CardTitle>
          <CardDescription>
            A página de teste mostra se os acentos saem certos e se o papel é o configurado.
          </CardDescription>
        </div>
        <Button onClick={() => setEditing('new')} disabled={!paired.length}>
          <Plus /> Nova impressora
        </Button>
      </CardHeader>
      <CardContent>
        {!printers.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Printer className="size-4" />
            {paired.length
              ? 'Nenhuma impressora cadastrada.'
              : 'Adicione primeiro o computador ligado às impressoras.'}
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {printers.map((p) => {
              const profile = printerProfile(p.profileId);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-48 flex-1">
                    <p className="font-medium">
                      {p.name}
                      {!p.active && <span className="text-muted-foreground"> (fora de uso)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        p.agentName,
                        `${PRINTER_CONNECTION_LABELS[p.connection]}${p.address ? `: ${p.address}` : ''}`,
                        `${profile.brand} ${profile.model}`,
                        `${p.paperWidth} mm`,
                        p.withoutAccents && 'sem acentos',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[
                        ...p.sectors.map(
                          (s) => `${s.name}${s.copies > 1 ? ` (${s.copies} vias)` : ''}`,
                        ),
                        p.isCashPrinter && 'Caixa',
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Nenhum setor usa esta impressora'}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANT[p.status]} title={p.statusDetail ?? undefined}>
                    {PRINTER_STATUS_LABELS[p.status]}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => void test(p)}>
                    <ScrollText /> Imprimir teste
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Editar ${p.name}`}
                    onClick={() => setEditing(p)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remover ${p.name}`}
                    onClick={() => setRemoving(p)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      <PrinterDialog
        printer={editing === 'new' ? null : editing}
        agents={paired}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remover ${removing?.name}?`}
        description="O que estava esperando esta impressora é descartado e os setores que a usavam ficam sem impressão automática."
        confirmLabel="Remover"
        destructive
        onConfirm={async () => {
          try {
            await removePrinter(removing!.id);
            await queryClient.invalidateQueries({ queryKey: printKeys.all });
            toast.success('Impressora removida');
          } catch (error) {
            toast.error(errorMessage(error));
          }
          setRemoving(null);
        }}
      />
    </Card>
  );
}
