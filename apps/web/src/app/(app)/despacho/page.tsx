'use client';

import {
  type CourierPositionDto,
  type DispatchCourierDto,
  type DispatchOrderDto,
  type GeoPointDto,
  PAYMENT_METHOD_LABELS,
  type RouteSuggestionDto,
  SIMULATION_SPEEDS,
  deadlineState,
  formatBRL,
  formatTime,
  showsBalanceFlag,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { Kbd } from '@app/ui/components/states';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  AlarmClockOff,
  Bike,
  Crosshair,
  List,
  Loader2,
  Map as MapIcon,
  MapPinOff,
  Route,
  Square,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DeliveryFailureBadge } from '@/components/delivery/failure';
import { LocationDialog } from '@/components/dispatch/location-dialog';
import { CourierPin, OrderPin, StopPin, StorePin } from '@/components/dispatch/pins';
import { type MapLine, type MapPin, MapView } from '@/components/map/map-view';
import { DragHandle, SortableList } from '@/components/menu/sortable-list';
import { BalanceFlag, CardFlag, elapsedLabel, useNow } from '@/components/orders/common';
import { Page } from '@/components/page';
import { ApiError, errorMessage } from '@/lib/api';
import { deliveryKeys } from '@/lib/delivery';
import {
  dispatchRun,
  dispatchKeys,
  startSimulation,
  stopSimulation,
  suggestRoute,
  useDispatchBoard,
} from '@/lib/dispatch';
import { useHotkeys } from '@/lib/hotkeys';
import { orderKeys, orderTitle } from '@/lib/orders';
import { useRealtime } from '@/lib/realtime';

const km = (meters: number) =>
  `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-bold tracking-wide text-muted-foreground uppercase">
      {children}
      {count != null && <span className="tabular">({count})</span>}
    </h2>
  );
}

function DeadlineFlag({ order, now }: { order: DispatchOrderDto; now: Date }) {
  const deadline = deadlineState(order.deadlineAt, now);
  if (!deadline) return null;
  return (
    <CardFlag
      tone={deadline.level === 'late' ? 'critical' : 'attention'}
      icon={deadline.level === 'late' ? AlarmClockOff : AlarmClock}
    >
      {deadline.level === 'late'
        ? `Atrasado ${deadline.minutes} min`
        : `Prazo em ${deadline.minutes} min`}
    </CardFlag>
  );
}

/** A ready order in the side list (checkbox = in the run being assembled). */
function ReadyRow({
  order,
  now,
  position,
  onToggle,
}: {
  order: DispatchOrderDto;
  now: Date;
  position: number | null;
  onToggle: () => void;
}) {
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-accent">
        <Checkbox
          className="mt-1"
          checked={position != null}
          onCheckedChange={onToggle}
          aria-label={`Pedido ${order.number}`}
        />
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-base font-bold">
              #{order.number} · {orderTitle(order)}
            </span>
            <span className="shrink-0 font-bold">{formatBRL(order.totalCents)}</span>
          </span>
          <span className="block truncate text-muted-foreground">
            {[order.addressLine, order.neighborhood].filter(Boolean).join(' · ')}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span>Pronto há {elapsedLabel(order.readyAt ?? order.createdAt, now)}</span>
            {order.expectedPaymentMethod && (
              <span className="inline-flex items-center gap-1">
                <Wallet className="size-3.5" aria-hidden />
                {PAYMENT_METHOD_LABELS[order.expectedPaymentMethod]}
              </span>
            )}
          </span>
          {showsBalanceFlag(order) && <BalanceFlag cents={order.balanceCents} />}
          <DeadlineFlag order={order} now={now} />
          {order.location?.precision === 'STREET' && (
            <CardFlag tone="attention" icon={MapPinOff}>
              Endereço aproximado: confira o pino
            </CardFlag>
          )}
          {order.deliveryFailure && <DeliveryFailureBadge failure={order.deliveryFailure} />}
        </span>
      </label>
    </li>
  );
}

function CourierCard({
  courier,
  position,
  simulationAllowed,
  onSimulate,
  onStopSimulation,
}: {
  courier: DispatchCourierDto;
  position: CourierPositionDto | null;
  simulationAllowed: boolean;
  onSimulate: (speed: number) => void;
  onStopSimulation: () => void;
}) {
  const run = courier.run;
  const pending = run?.stops.filter((s) => s.status === 'PENDING') ?? [];
  const lastEta = pending.at(-1)?.etaAt ?? null;
  return (
    <li
      className="space-y-2 rounded-card border bg-card p-3"
      aria-label={`Entregador ${courier.name}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-semibold">
            <Bike className="size-4 text-muted-foreground" aria-hidden />
            {courier.name}
            {courier.simulated && <Badge variant="outline">simulado</Badge>}
          </span>
          <span className="block text-sm text-muted-foreground">
            {run
              ? `Em rota · ${pending.length} de ${run.stops.length} a entregar` +
                (lastEta ? ` · última por volta de ${formatTime(lastEta)}` : '')
              : 'Livre'}
          </span>
          {run && position && (
            <span className="block text-xs text-muted-foreground">
              Posição às {formatTime(position.recordedAt)}
            </span>
          )}
        </span>
        <Badge variant={run ? 'info' : 'success'}>{run ? 'Em rota' : 'Livre'}</Badge>
      </div>
      {courier.simulated && run ? (
        <p className="text-sm text-muted-foreground">
          Entregador de demonstração: percorre a rota sem parar.
        </p>
      ) : (
        run &&
        simulationAllowed &&
        run.geometry && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {run.simulating ? (
              <Button size="sm" variant="outline" onClick={onStopSimulation}>
                <Square /> Parar simulação
              </Button>
            ) : (
              <>
                <span className="text-muted-foreground">Simular percurso:</span>
                {SIMULATION_SPEEDS.map((speed) => (
                  <Button key={speed} size="sm" variant="outline" onClick={() => onSimulate(speed)}>
                    {speed}×
                  </Button>
                ))}
              </>
            )}
          </div>
        )
      )}
    </li>
  );
}

/**
 * Dispatch (D048): ready deliveries on the map, the run assembled by clicking pins or the list,
 * the suggested order (our function over the routing service's times) reordered by drag and
 * confirmed with F9. Wrong pins are dragged to the right place; orders without a point are
 * marked by a click on the map.
 */
export default function DispatchPage() {
  const board = useDispatchBoard();
  const queryClient = useQueryClient();
  const now = useNow();
  const { onCourierPosition } = useRealtime();
  const [selected, setSelected] = useState<string[]>([]);
  const [courierId, setCourierId] = useState<string | null>(null);
  const [route, setRoute] = useState<RouteSuggestionDto | null>(null);
  const [planning, setPlanning] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [marking, setMarking] = useState<DispatchOrderDto | null>(null);
  const [pending, setPending] = useState<{ order: DispatchOrderDto; point: GeoPointDto } | null>(
    null,
  );
  const [positions, setPositions] = useState<Record<string, CourierPositionDto>>({});
  const [tab, setTab] = useState<'map' | 'list'>('map');
  const [fitKey, setFitKey] = useState<string | undefined>(undefined);
  const planRequest = useRef(0);

  const data = board.data;
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const ready = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'READY')
        .sort((a, b) => (a.readyAt ?? a.createdAt).localeCompare(b.readyAt ?? b.createdAt)),
    [orders],
  );
  const located = ready.filter((o) => o.location);
  const preparing = orders.filter((o) => o.status !== 'READY' && o.location);
  const unlocated = orders.filter((o) => !o.location);
  const couriers = useMemo(() => data?.couriers ?? [], [data]);
  // Orders that left (or lost the point) drop out of the run being assembled.
  const chosen = selected
    .map((id) => located.find((o) => o.id === id))
    .filter((o): o is DispatchOrderDto => !!o);
  const chosenIds = chosen.map((o) => o.id).join(',');
  const routeIsCurrent = !!route && route.orderIds.join(',') === chosenIds;

  // Positions arrive by realtime (the board brings the last stored one).
  useEffect(
    () => onCourierPosition((event) => setPositions((all) => ({ ...all, [event.runId]: event }))),
    [onCourierPosition],
  );

  // Fit the map once the first board arrives.
  const firstLoad = !!data;
  useEffect(() => {
    if (firstLoad) setFitKey('first');
  }, [firstLoad]);

  async function plan(ids: string[], keepOrder: boolean) {
    const request = ++planRequest.current;
    if (!ids.length) {
      setRoute(null);
      return;
    }
    setPlanning(true);
    try {
      const result = await suggestRoute({ orderIds: ids, keepOrder });
      if (request !== planRequest.current) return;
      setSelected(result.orderIds);
      setRoute(result);
      if (!keepOrder) setFitKey(`route-${request}`);
    } catch (error) {
      if (request === planRequest.current) toast.error(errorMessage(error));
    } finally {
      if (request === planRequest.current) setPlanning(false);
    }
  }

  function toggle(id: string) {
    const ids = chosen.map((o) => o.id);
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
    setSelected(next);
    // With a route on screen, it follows the new list (keeping the order chosen so far).
    if (route) void plan(next, true);
  }

  function reorder(ids: string[]) {
    setSelected(ids);
    void plan(ids, true);
  }

  async function dispatch() {
    if (dispatching) return;
    if (!chosen.length) {
      toast.error('Selecione os pedidos que saem juntos');
      return;
    }
    if (!courierId) {
      toast.error('Escolha o entregador');
      return;
    }
    setDispatching(true);
    try {
      await dispatchRun(courierId, chosen);
      const courier = couriers.find((c) => c.id === courierId);
      toast.success(
        `${chosen.length === 1 ? 'Pedido saiu' : `${chosen.length} pedidos saíram`} com ${courier?.name ?? 'o entregador'}`,
      );
      planRequest.current++;
      setSelected([]);
      setRoute(null);
      setCourierId(null);
      setPlanning(false);
    } catch (error) {
      toast.error(errorMessage(error));
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: dispatchKeys.board });
      }
    } finally {
      setDispatching(false);
      void queryClient.invalidateQueries({ queryKey: orderKeys.all });
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.all });
    }
  }

  async function simulate(runId: string, speed: number | null) {
    try {
      if (speed == null) await stopSimulation(runId);
      else await startSimulation(runId, { speed: speed as 1 | 5 | 20 });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: dispatchKeys.board });
    }
  }

  useHotkeys(
    {
      F9: () => void dispatch(),
      Escape: () => setMarking(null),
    },
    !pending,
  );

  const pins = useMemo<MapPin[]>(() => {
    if (!data) return [];
    const list: MapPin[] = [];
    if (data.store.location) {
      list.push({
        id: 'store',
        position: data.store.location,
        label: `Loja ${data.store.name}`,
        content: <StorePin />,
        layer: 1,
      });
    }
    for (const order of preparing) {
      list.push({
        id: `order-${order.id}`,
        position: order.location!,
        label: `Pedido ${order.number}, em preparo`,
        content: <OrderPin number={order.number} deadline={null} position={null} preparing />,
      });
    }
    for (const order of located) {
      const index = chosen.findIndex((o) => o.id === order.id);
      const position = pending?.order.id === order.id ? pending.point : order.location!;
      const deadline = deadlineState(order.deadlineAt, now);
      list.push({
        id: `order-${order.id}`,
        position,
        label:
          `Pedido ${order.number}, pronto` +
          (deadline?.level === 'late' ? `, atrasado ${deadline.minutes} min` : '') +
          (deadline?.level === 'warning' ? `, prazo em ${deadline.minutes} min` : '') +
          (index >= 0 ? `, ${index + 1}º da saída` : ''),
        content: (
          <OrderPin
            number={order.number}
            deadline={deadline}
            position={index >= 0 ? index + 1 : null}
          />
        ),
        draggable: true,
        onClick: () => toggle(order.id),
        onDragEnd: (point) => setPending({ order, point }),
        layer: index >= 0 ? 3 : 2,
      });
    }
    for (const courier of data.couriers) {
      const run = courier.run;
      if (!run) continue;
      for (const stop of run.stops) {
        if (!stop.location) continue;
        list.push({
          id: `stop-${stop.orderId}`,
          position: stop.location,
          label: `Pedido ${stop.number} com ${courier.name}`,
          content: <StopPin number={stop.number} status={stop.status} />,
        });
      }
      const position = positions[run.id] ?? run.position;
      if (position) {
        list.push({
          id: `courier-${courier.id}`,
          position,
          label: `${courier.name}${courier.simulated ? ' (simulado)' : ''}, posição às ${formatTime(position.recordedAt)}`,
          content: <CourierPin name={courier.name} simulated={courier.simulated} />,
          layer: 4,
        });
      }
    }
    return list;
    // `toggle` reads the current selection; rebuilding with it keeps the click right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, chosenIds, positions, pending, now, route]);

  const lines = useMemo<MapLine[]>(() => {
    const list: MapLine[] = [];
    for (const courier of couriers) {
      const run = courier.run;
      if (run?.geometry) {
        list.push({
          id: `run-${run.id}`,
          coordinates: run.geometry,
          tone: 'dispatched',
          dashed: run.routeSource === 'STRAIGHT',
        });
      }
    }
    if (route && routeIsCurrent) {
      list.push({
        id: 'suggestion',
        coordinates: route.geometry,
        tone: 'primary',
        dashed: route.source === 'STRAIGHT',
      });
    }
    return list;
  }, [couriers, route, routeIsCurrent]);

  function onMapClick(point: GeoPointDto) {
    if (!marking) return;
    setPending({ order: marking, point });
    setMarking(null);
  }

  const legs = routeIsCurrent ? new Map(route.legs.map((l) => [l.orderId, l])) : null;
  const lastLeg = routeIsCurrent ? route.legs.at(-1) : null;

  return (
    <Page
      title="Despacho"
      dated
      className="flex max-w-none flex-col lg:h-[calc(100dvh-4rem)]"
      actions={
        data?.routing === 'STRAIGHT' ? (
          <Badge variant="outline">Rotas em linha reta (serviço de rotas desligado)</Badge>
        ) : null
      }
    >
      <div className="flex gap-2 lg:hidden" role="tablist" aria-label="Visão">
        <Button
          role="tab"
          aria-selected={tab === 'map'}
          variant={tab === 'map' ? 'default' : 'outline'}
          onClick={() => setTab('map')}
        >
          <MapIcon /> Mapa
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'list'}
          variant={tab === 'list' ? 'default' : 'outline'}
          onClick={() => setTab('list')}
        >
          <List /> Lista
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div
          className={cn(
            'relative h-[70dvh] lg:h-auto lg:min-h-0',
            tab !== 'map' && 'hidden lg:block',
          )}
        >
          {!data ? (
            <Skeleton className="size-full rounded-card" />
          ) : (
            <MapView
              aria-label="Mapa do despacho"
              center={data.store.location ?? { latitude: -23.5649, longitude: -46.6519 }}
              pins={pins}
              lines={lines}
              fitKey={fitKey}
              onMapClick={marking ? onMapClick : undefined}
            />
          )}
          {marking && (
            <div
              role="status"
              className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 rounded-card border bg-card p-3 text-sm shadow-lg"
            >
              <span>
                <Crosshair className="mr-1.5 inline size-4" aria-hidden />
                Clique no mapa onde fica o pedido #{marking.number}
                {marking.addressLine ? ` (${marking.addressLine})` : ''}.
              </span>
              <Button size="sm" variant="outline" onClick={() => setMarking(null)}>
                Cancelar <Kbd>Esc</Kbd>
              </Button>
            </div>
          )}
        </div>

        <aside
          aria-label="Saída e pedidos"
          className={cn(
            'min-h-0 space-y-5 overflow-y-auto lg:pr-1',
            tab !== 'list' && 'hidden lg:block',
          )}
        >
          <section className="space-y-3 rounded-card border bg-card p-4">
            <h2 className="text-lg font-bold">Nova saída</h2>
            {chosen.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Clique nos pinos ou marque na lista os pedidos que saem juntos.
              </p>
            ) : (
              <SortableList
                items={chosen}
                onReorder={reorder}
                className="divide-y rounded-md border"
                renderItem={(order) => {
                  const leg = legs?.get(order.id);
                  return (
                    <div className="flex items-center gap-2 bg-card p-2 text-sm">
                      <DragHandle label={`Mover o pedido ${order.number} na ordem`} />
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        {chosen.indexOf(order) + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">
                          #{order.number} · {order.neighborhood ?? order.addressLine}
                        </span>
                        {leg && (
                          <span className="block text-xs text-muted-foreground">
                            Chega por volta de {formatTime(leg.etaAt)} · {km(leg.distanceMeters)}
                          </span>
                        )}
                      </span>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Tirar o pedido ${order.number} da saída`}
                        onClick={() => toggle(order.id)}
                      >
                        <X />
                      </Button>
                    </div>
                  );
                }}
              />
            )}

            {routeIsCurrent && (
              <div className="space-y-2 text-sm">
                <p className="font-semibold">
                  {km(route.distanceMeters)} · {minutes(route.durationSeconds)} até a última entrega
                  {lastLeg ? ` (por volta de ${formatTime(lastLeg.etaAt)})` : ''}
                </p>
                {route.fallback ? (
                  <CardFlag tone="attention">
                    Serviço de rotas indisponível: estimativa em linha reta e ordem pela distância.
                  </CardFlag>
                ) : (
                  route.source === 'STRAIGHT' && (
                    <p className="text-muted-foreground">Estimativa em linha reta.</p>
                  )
                )}
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium">Entregador</h3>
              {couriers.length === 0 && !board.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum entregador ativo. Cadastre em Entregadores.
                </p>
              ) : (
                <div role="radiogroup" aria-label="Entregador" className="grid grid-cols-2 gap-2">
                  {couriers.map((c) => (
                    <Button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={courierId === c.id}
                      variant={courierId === c.id ? 'default' : 'outline'}
                      className="h-auto min-w-0 flex-col items-start gap-0.5 py-2 text-left whitespace-normal"
                      onClick={() => setCourierId(c.id)}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 font-medium">
                        <Bike className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span
                        className={cn(
                          'text-xs',
                          courierId === c.id
                            ? 'text-primary-foreground/80'
                            : 'text-muted-foreground',
                        )}
                      >
                        {c.run ? 'Em rota: entra na mesma saída' : 'Livre'}
                        {c.simulated ? ' · simulado' : ''}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={chosen.length === 0}
                loading={planning}
                onClick={() =>
                  void plan(
                    chosen.map((o) => o.id),
                    false,
                  )
                }
              >
                <Route /> Sugerir ordem
              </Button>
              <Button
                className="flex-1"
                loading={dispatching}
                disabled={chosen.length === 0 || !courierId}
                onClick={() => void dispatch()}
              >
                <Bike /> Despachar
                {chosen.length > 1 ? ` (${chosen.length})` : ''}
                <Kbd className="ml-1">F9</Kbd>
              </Button>
            </div>
          </section>

          <section className="space-y-2">
            <SectionTitle count={located.length}>Prontos</SectionTitle>
            {board.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : located.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum delivery pronto no mapa.</p>
            ) : (
              <ul className="divide-y rounded-card border bg-card">
                {located.map((order) => {
                  const index = chosen.findIndex((o) => o.id === order.id);
                  return (
                    <ReadyRow
                      key={order.id}
                      order={order}
                      now={now}
                      position={index >= 0 ? index + 1 : null}
                      onToggle={() => toggle(order.id)}
                    />
                  );
                })}
              </ul>
            )}
          </section>

          {unlocated.length > 0 && (
            <section className="space-y-2">
              <SectionTitle count={unlocated.length}>Marcar no mapa</SectionTitle>
              <ul className="divide-y rounded-card border bg-card">
                {unlocated.map((order) => (
                  <li key={order.id} className="flex items-center gap-3 p-3 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">
                        #{order.number} · {orderTitle(order)}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {[order.addressLine, order.neighborhood].filter(Boolean).join(' · ') ||
                          'Sem endereço'}
                      </span>
                    </span>
                    {order.locating ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden /> Localizando
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMarking(order);
                          setTab('map');
                        }}
                      >
                        <Crosshair /> Marcar no mapa
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {preparing.length > 0 && (
            <section className="space-y-2">
              <SectionTitle count={preparing.length}>Em preparo</SectionTitle>
              <ul className="divide-y rounded-card border bg-card text-sm">
                {preparing.map((order) => (
                  <li key={order.id} className="flex justify-between gap-2 p-3">
                    <span className="truncate">
                      #{order.number} · {order.neighborhood ?? order.addressLine}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      há {elapsedLabel(order.createdAt, now)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <SectionTitle count={couriers.length}>Entregadores</SectionTitle>
            <ul className="space-y-2">
              {couriers.map((courier) => (
                <CourierCard
                  key={courier.id}
                  courier={courier}
                  position={
                    courier.run ? (positions[courier.run.id] ?? courier.run.position) : null
                  }
                  simulationAllowed={!!data?.simulationAllowed}
                  onSimulate={(speed) => void simulate(courier.run!.id, speed)}
                  onStopSimulation={() => void simulate(courier.run!.id, null)}
                />
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <LocationDialog
        pending={pending}
        onClose={() => setPending(null)}
        onSaved={(orderId) => {
          void queryClient.invalidateQueries({ queryKey: dispatchKeys.board });
          if (route && chosen.some((o) => o.id === orderId)) {
            void plan(
              chosen.map((o) => o.id),
              true,
            );
          }
        }}
      />
    </Page>
  );
}
