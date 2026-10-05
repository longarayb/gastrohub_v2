'use client';

import {
  KDS_PAIRING_TTL_MINUTES,
  type KdsDeviceDto,
  type KdsPairingCodeDto,
  type SectorDto,
  formatDateTime,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { Checkbox } from '@app/ui/components/checkbox';
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
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, MonitorSmartphone, Pencil, Plus, Unplug } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { errorMessage } from '@/lib/api';
import {
  createKdsDevice,
  kdsKeys,
  newPairingCode,
  revokeKdsDevice,
  updateKdsDevice,
  useKdsDevices,
} from '@/lib/kds';

const STATE_LABELS: Record<KdsDeviceDto['state'], string> = {
  PENDING: 'Aguardando vínculo',
  PAIRED: 'Vinculada',
  REVOKED: 'Desvinculada',
};

function DeviceDialog({
  device,
  sectors,
  open,
  onOpenChange,
  onCode,
}: {
  device: KdsDeviceDto | null;
  sectors: SectorDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCode: (code: KdsPairingCodeDto) => void;
}) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const [name, setName] = useState('');
  const [sectorIds, setSectorIds] = useState<string[]>([]);
  const [expedition, setExpedition] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(device?.name ?? '');
    setSectorIds(device?.sectorIds ?? []);
    setExpedition(device?.showsExpedition ?? false);
    setError(undefined);
  }, [open, device]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Informe um nome para a tela');
    if (!sectorIds.length && !expedition)
      return setError('Escolha pelo menos um setor ou a expedição');
    setBusy(true);
    try {
      const input = { name: name.trim(), sectorIds, showsExpedition: expedition };
      if (device) {
        await updateKdsDevice(device.id, input);
        toast.success('Tela atualizada');
      } else {
        onCode(await createKdsDevice(input));
      }
      await queryClient.invalidateQueries({ queryKey: kdsKeys.devices });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{device ? `Editar ${device.name}` : 'Nova tela da cozinha'}</DialogTitle>
            <DialogDescription>
              Tablet ou TV que mostra os pedidos dos setores escolhidos, sem login com senha.
            </DialogDescription>
          </DialogHeader>
          <Field label="Nome" htmlFor={nameId}>
            <Input
              id={nameId}
              value={name}
              maxLength={60}
              placeholder="Ex.: Tablet da chapa"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Setores</legend>
            {sectors.map((s) => (
              <Label key={s.id} className="flex items-center gap-2 font-normal">
                <Checkbox
                  checked={sectorIds.includes(s.id)}
                  onCheckedChange={(on) =>
                    setSectorIds((ids) =>
                      on === true ? [...ids, s.id] : ids.filter((id) => id !== s.id),
                    )
                  }
                />
                {s.name}
              </Label>
            ))}
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={expedition} onCheckedChange={(on) => setExpedition(on === true)} />
              Expedição (todos os setores e saída do delivery)
            </Label>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" loading={busy}>
              {device ? 'Salvar' : 'Criar e gerar código'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CodeDialog({
  code,
  onOpenChange,
}: {
  code: KdsPairingCodeDto | null;
  onOpenChange: (o: boolean) => void;
}) {
  const url =
    code && typeof window !== 'undefined'
      ? `${window.location.origin}/kds/vincular?loja=${code.storeSlug}`
      : '';
  return (
    <Dialog open={!!code} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {code && (
          <>
            <DialogHeader>
              <DialogTitle>Vincular {code.device.name}</DialogTitle>
              <DialogDescription>
                No tablet, abra o endereço abaixo e digite os códigos. O código vale por{' '}
                {KDS_PAIRING_TTL_MINUTES} minutos e é invalidado após 5 tentativas erradas.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 text-center">
              <p className="rounded-md bg-muted p-2 font-mono text-sm break-all">{url}</p>
              <p className="text-sm text-muted-foreground">Código da unidade</p>
              <p className="font-mono text-2xl font-semibold">{code.storeSlug}</p>
              <p className="text-sm text-muted-foreground">Código de vínculo</p>
              <p
                className="tabular font-mono text-5xl font-bold tracking-[0.3em]"
                aria-label="Código de vínculo"
              >
                {code.code}
              </p>
              <p className="text-xs text-muted-foreground">
                Válido até {formatDateTime(code.expiresAt)}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Kitchen screens (D028): created by managers, paired with a code, revocable. */
export function KdsDevicesCard({ sectors }: { sectors: SectorDto[] }) {
  const queryClient = useQueryClient();
  const { data: devices, isLoading } = useKdsDevices();
  const [editing, setEditing] = useState<KdsDeviceDto | 'new' | null>(null);
  const [code, setCode] = useState<KdsPairingCodeDto | null>(null);
  const [revoking, setRevoking] = useState<KdsDeviceDto | null>(null);
  const names = new Map(sectors.map((s) => [s.id, s.name]));

  async function regenerate(device: KdsDeviceDto) {
    try {
      setCode(await newPairingCode(device.id));
      await queryClient.invalidateQueries({ queryKey: kdsKeys.devices });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Telas da cozinha</CardTitle>
          <CardDescription>
            Tablets e TVs vinculados aos setores, sem login com senha. Abra em{' '}
            <span className="font-mono">/kds</span>.
          </CardDescription>
        </div>
        <Button onClick={() => setEditing('new')}>
          <Plus /> Nova tela
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20" />
        ) : !devices?.length ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MonitorSmartphone className="size-4" /> Nenhuma tela cadastrada.
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{d.name}</p>
                  <p className="text-muted-foreground">
                    {[
                      ...d.sectorIds.map((id) => names.get(id) ?? 'Setor removido'),
                      ...(d.showsExpedition ? ['Expedição'] : []),
                    ].join(' · ')}
                  </p>
                  {d.lastSeenAt && (
                    <p className="text-xs text-muted-foreground">
                      Último acesso {formatDateTime(d.lastSeenAt)}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    d.state === 'PAIRED'
                      ? 'default'
                      : d.state === 'REVOKED'
                        ? 'destructive'
                        : 'secondary'
                  }
                >
                  {STATE_LABELS[d.state]}
                </Badge>
                {d.state !== 'REVOKED' && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => void regenerate(d)}>
                      <KeyRound />{' '}
                      {d.state === 'PAIRED' ? 'Vincular outro aparelho' : 'Novo código'}
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Editar ${d.name}`}
                      onClick={() => setEditing(d)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setRevoking(d)}
                    >
                      <Unplug /> Desvincular
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <DeviceDialog
        device={editing === 'new' ? null : editing}
        sectors={sectors.filter((s) => s.isActive)}
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onCode={setCode}
      />
      <CodeDialog code={code} onOpenChange={(o) => !o && setCode(null)} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Desvincular ${revoking?.name}?`}
        description="A tela perde o acesso na hora. Para usar de novo, crie outra tela."
        confirmLabel="Desvincular"
        destructive
        onConfirm={async () => {
          try {
            await revokeKdsDevice(revoking!.id);
            await queryClient.invalidateQueries({ queryKey: kdsKeys.devices });
            toast.success('Tela desvinculada');
          } catch (error) {
            toast.error(errorMessage(error));
          }
          setRevoking(null);
        }}
      />
    </Card>
  );
}
