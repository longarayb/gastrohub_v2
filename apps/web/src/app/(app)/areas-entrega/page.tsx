'use client';

import { type DeliveryAreaDto, Permission, formatBRL } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { Notice } from '@app/ui/components/notice';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import { MapPinned, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AreaFormDialog, PauseAreaDialog } from '@/components/delivery/area-dialogs';
import { formatClock } from '@/components/orders/common';
import { EmptyState, Page } from '@/components/page';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  addAreaNeighborhood,
  deliveryKeys,
  formatDistance,
  removeDeliveryArea,
  resumeDeliveryArea,
  useDeliveryAreas,
  useUnmatchedNeighborhoods,
} from '@/lib/delivery';

function AreaCard({
  area,
  canManage,
  onEdit,
  onPause,
  onResume,
  onRemove,
}: {
  area: DeliveryAreaDto;
  canManage: boolean;
  onEdit: () => void;
  onPause: () => void;
  onResume: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      aria-label={`Área ${area.name}`}
      className={cn(
        'flex flex-col gap-3 rounded-card border bg-card p-4',
        area.paused && 'border-destructive/50',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{area.name}</p>
          <p className="text-xs text-muted-foreground">
            {area.kind === 'RADIUS'
              ? `Raio de ${formatDistance(area.radiusMeters)}`
              : `Por bairro${area.city ? ` · ${area.city}` : ''}`}
          </p>
        </div>
        {area.paused && <Badge variant="destructive">Suspensa</Badge>}
      </header>
      {area.paused && (
        <Notice tone="critical" className="p-2">
          {area.pausedReason}
          {area.pausedUntil ? ` · volta às ${formatClock(area.pausedUntil)}` : ''}
        </Notice>
      )}
      {area.kind === 'NEIGHBORHOOD' && (
        <ul className="flex flex-wrap gap-1" aria-label="Bairros">
          {area.neighborhoods.map((n) => (
            <li key={n} className="rounded bg-muted px-1.5 py-0.5 text-xs">
              {n}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Taxa</dt>
        <dd className="tabular text-right font-medium">{formatBRL(area.feeCents)}</dd>
        <dt className="text-muted-foreground">Tempo</dt>
        <dd className="tabular text-right">{area.etaMinutes} min</dd>
        {area.minimumOrderCents != null && (
          <>
            <dt className="text-muted-foreground">Mínimo</dt>
            <dd className="tabular text-right">{formatBRL(area.minimumOrderCents)}</dd>
          </>
        )}
        {area.freeAboveCents != null && (
          <>
            <dt className="text-muted-foreground">Grátis acima de</dt>
            <dd className="tabular text-right">{formatBRL(area.freeAboveCents)}</dd>
          </>
        )}
      </dl>
      <div className="mt-auto flex flex-wrap gap-2">
        {area.paused ? (
          <Button size="sm" onClick={onResume}>
            <Play /> Retomar
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onPause}>
            <Pause /> Suspender
          </Button>
        )}
        {canManage && (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Editar ${area.name}`}>
              <Pencil />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={onRemove}
              aria-label={`Excluir ${area.name}`}
            >
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

/** Neighborhoods of recent orders and customers that no area covers. */
function UnmatchedCard({ areas }: { areas: DeliveryAreaDto[] }) {
  const queryClient = useQueryClient();
  const { data } = useUnmatchedNeighborhoods();
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const named = areas.filter((a) => a.kind === 'NEIGHBORHOOD');
  if (!data?.length || named.length === 0) return null;

  async function include(neighborhood: string, key: string) {
    const areaId = target[key];
    if (!areaId) return;
    setBusy(key);
    try {
      await addAreaNeighborhood(areaId, neighborhood);
      await queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
      toast.success(`${neighborhood} incluído na área`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bairros sem área</CardTitle>
        <CardDescription>
          Apareceram em pedidos ou clientes dos últimos 60 dias e não bateram com nenhuma área.
          Inclua como variação de uma área existente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm" aria-label="Bairros sem área">
          {data.map((u) => {
            const key = `${u.city}|${u.neighborhood}`;
            return (
              <li key={key} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{u.neighborhood}</span>{' '}
                  <span className="text-muted-foreground">
                    · {u.city} · {u.occurrences}×
                  </span>
                </span>
                <Select
                  value={target[key] ?? ''}
                  onValueChange={(v) => setTarget((t) => ({ ...t, [key]: v }))}
                >
                  <SelectTrigger className="w-44" aria-label={`Área para ${u.neighborhood}`}>
                    <SelectValue placeholder="Escolha a área" />
                  </SelectTrigger>
                  <SelectContent>
                    {named.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!target[key]}
                  loading={busy === key}
                  onClick={() => void include(u.neighborhood, key)}
                >
                  Incluir
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Delivery areas by neighborhood (default) or radius, with temporary suspension (D029). */
export default function DeliveryAreasPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can(Permission.DELIVERY_MANAGE);
  const { data, isLoading } = useDeliveryAreas();
  const [editing, setEditing] = useState<DeliveryAreaDto | 'new' | null>(null);
  const [pausing, setPausing] = useState<DeliveryAreaDto | null>(null);
  const [removing, setRemoving] = useState<DeliveryAreaDto | null>(null);
  const areas = data ?? [];

  async function act(fn: () => Promise<unknown>, success: string) {
    try {
      await fn();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    }
  }

  return (
    <Page
      title="Áreas de entrega"
      description="A taxa, o tempo e o pedido mínimo de cada região. O pedido acha a área pelo bairro do endereço."
      actions={
        canManage && (
          <Button onClick={() => setEditing('new')}>
            <Plus /> Nova área
          </Button>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : areas.length === 0 ? (
        <EmptyState
          icon={MapPinned}
          title="Nenhuma área cadastrada"
          description="Sem áreas, a taxa de entrega é digitada em cada pedido."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((a) => (
            <AreaCard
              key={a.id}
              area={a}
              canManage={canManage}
              onEdit={() => setEditing(a)}
              onPause={() => setPausing(a)}
              onResume={() =>
                void act(() => resumeDeliveryArea(a.id), `Entrega retomada para ${a.name}`)
              }
              onRemove={() => setRemoving(a)}
            />
          ))}
        </div>
      )}

      {canManage && <UnmatchedCard areas={areas} />}

      <AreaFormDialog
        open={!!editing}
        area={editing === 'new' ? null : editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />
      <PauseAreaDialog area={pausing} onOpenChange={(v) => !v && setPausing(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Excluir a área ${removing?.name ?? ''}?`}
        description="Pedidos antigos continuam com o nome da área."
        confirmLabel="Excluir"
        destructive
        onConfirm={() =>
          act(() => removeDeliveryArea(removing!.id), 'Área excluída').then(() => setRemoving(null))
        }
      />
    </Page>
  );
}
