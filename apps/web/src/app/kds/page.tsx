'use client';

import { type KdsExpeditionOrderDto, type KdsTicketDto, consolidate } from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  ChefHat,
  Expand,
  Layers,
  LogOut,
  PackageCheck,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExpeditionBoard } from '@/components/kds/expedition';
import { TicketCard } from '@/components/kds/ticket-card';
import { FullPageSpinner } from '@/components/page';
import { ApiError, errorMessage } from '@/lib/api';
import {
  dispatchOrder,
  kdsKeys,
  pauseProduct,
  readyTasks,
  recallTask,
  resumeProduct,
  serveRounds,
  startTasks,
  useKdsBoard,
  useKdsExpedition,
  useKdsProducts,
  useKdsSectors,
} from '@/lib/kds';
import { enterFullscreen, toggleFullscreen, useKdsSound, useWakeLock } from '@/lib/kds-screen';
import { KDS_REVOKED_KEY, useKdsRealtime, useKdsSession } from '@/lib/kds-session';

const VIEW_KEY = 'kds-view';
const EXPEDITION = 'expedition';

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: preferences reset on reload.
  }
}

function SoldOutDialog({
  open,
  onOpenChange,
  sectorIds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectorIds: string[];
}) {
  const queryClient = useQueryClient();
  const { data: products, isLoading } = useKdsProducts(sectorIds, open);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(id: string, paused: boolean) {
    setBusy(id);
    try {
      await (paused ? resumeProduct(id) : pauseProduct(id));
      await queryClient.invalidateQueries({ queryKey: kdsKeys.products(sectorIds) });
      toast.success(
        paused ? 'Produto voltou ao cardápio' : 'Marcado como "Acabou" até o fim do dia',
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Acabou</DialogTitle>
          <DialogDescription>
            Pause um produto até o fim do dia: ele some do cardápio e do PDV.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="divide-y rounded-md border">
            {products?.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className={cn('text-lg font-medium', p.paused && 'line-through opacity-60')}>
                    {p.name}
                  </p>
                  <p className="text-sm text-muted-foreground">{p.categoryName}</p>
                </div>
                <Button
                  size="lg"
                  variant={p.paused ? 'outline' : 'destructive'}
                  className="h-12 min-w-32 text-base"
                  loading={busy === p.id}
                  onClick={() => void toggle(p.id, p.paused)}
                >
                  {p.paused ? 'Voltou' : 'Acabou'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Column({
  title,
  count,
  children,
  className,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex min-h-0 flex-col gap-3', className)} aria-label={title}>
      <h2 className="flex items-center justify-between text-lg font-semibold text-muted-foreground">
        {title}
        <span className="tabular rounded-md bg-muted px-2 text-base">{count}</span>
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

export default function KdsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { mode, storeName, signOut } = useKdsSession();
  const ready = mode.kind === 'device' || mode.kind === 'user';
  const device = mode.kind === 'device' ? mode.session.device : null;

  const [started, setStarted] = useState(false);
  const [view, setView] = useState<string[] | null>(null);
  const [consolidated, setConsolidated] = useState(false);
  const [soldOut, setSoldOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const sound = useKdsSound();
  const awake = useWakeLock(started);

  useEffect(() => {
    if (mode.kind === 'none') router.replace('/kds/vincular');
  }, [mode.kind, router]);

  const sectors = useKdsSectors(ready);
  const allowedIds = useMemo(() => (sectors.data ?? []).map((s) => s.id), [sectors.data]);
  const canExpedite = mode.kind === 'user' || !!device?.showsExpedition;

  // Remembered view (sectors or expedition), restricted to what this screen may show.
  useEffect(() => {
    if (!sectors.data || view) return;
    const saved = readStored(VIEW_KEY)?.split(',').filter(Boolean) ?? [];
    const valid = saved.filter(
      (id) => allowedIds.includes(id) || (id === EXPEDITION && canExpedite),
    );
    setView(valid.length ? valid : allowedIds.length ? allowedIds : [EXPEDITION]);
  }, [sectors.data, allowedIds, canExpedite, view]);

  const expedition = view?.includes(EXPEDITION) ?? false;
  const sectorIds = useMemo(() => (view ?? []).filter((id) => id !== EXPEDITION), [view]);
  const board = useKdsBoard(sectorIds, ready && !expedition);
  const expeditionData = useKdsExpedition(ready && expedition);

  // Revoked by the manager: the realtime event, or a request answered 403 before it arrives
  // (the access token is still valid, the device is not). Either way, once, without errors.
  const revokedOnce = useRef(false);
  const onRevoked = useCallback(() => {
    if (revokedOnce.current) return;
    revokedOnce.current = true;
    try {
      sessionStorage.setItem(KDS_REVOKED_KEY, '1');
    } catch {
      // Storage blocked: the pairing page just skips the notice.
    }
    void signOut().then(() => router.replace('/kds/vincular'));
  }, [signOut, router]);

  const realtime = useKdsRealtime({
    enabled: ready,
    isDevice: mode.kind === 'device',
    onRevoked,
  });

  const forbidden = [sectors.error, board.error, expeditionData.error].some(
    (e) => e instanceof ApiError && e.status === 403,
  );
  useEffect(() => {
    if (forbidden && mode.kind === 'device') onRevoked();
  }, [forbidden, mode.kind, onRevoked]);

  // Timers follow the server clock (tablets often have a wrong time).
  const [offset, setOffset] = useState(0);
  const serverTime = board.data?.serverTime ?? expeditionData.data?.serverTime;
  useEffect(() => {
    if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now());
  }, [serverTime]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const serverNow = now + offset;

  // Sounds: a new ticket chimes; a canceled item plays the cancel tone (not on first load).
  const known = useRef<{ tickets: Set<string>; canceled: Set<string> } | null>(null);
  const tickets = board.data?.tickets;
  const { play } = sound;
  useEffect(() => {
    if (!tickets) return;
    const open = new Set(tickets.filter((t) => !t.doneAt && !t.canceled).map((t) => t.key));
    const canceled = new Set(
      tickets.flatMap((t) => t.tasks.filter((x) => x.status === 'CANCELED').map((x) => x.id)),
    );
    const previous = known.current;
    known.current = { tickets: open, canceled };
    if (!previous) return;
    if ([...canceled].some((id) => !previous.canceled.has(id))) play('canceled');
    else if ([...open].some((key) => !previous.tickets.has(key))) play('new');
  }, [tickets, play]);
  // Changing the view resets what is "new".
  useEffect(() => {
    known.current = null;
  }, [view]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      try {
        await fn();
        if (success) toast.success(success);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setBusy(false);
        void queryClient.invalidateQueries({ queryKey: kdsKeys.all });
      }
    },
    [queryClient],
  );

  const actions = useMemo(
    () => ({
      busy,
      start: (ids: string[]) => void run(() => startTasks(ids)),
      ready: (ids: string[]) => void run(() => readyTasks(ids)),
      recall: (id: string) => void run(() => recallTask(id), 'Item voltou para o preparo'),
    }),
    [busy, run],
  );

  function chooseView(id: string) {
    let next: string[];
    if (id === EXPEDITION) next = [EXPEDITION];
    else {
      const current = (view ?? []).filter((v) => v !== EXPEDITION);
      next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
      if (!next.length) next = [id];
    }
    setView(next);
    store(VIEW_KEY, next.join(','));
  }

  async function start() {
    await sound.enable().catch(() => undefined);
    await enterFullscreen();
    setStarted(true);
  }

  if (!ready) return <FullPageSpinner />;

  const sectorById = new Map((board.data?.sectors ?? sectors.data ?? []).map((s) => [s.id, s]));
  const visible = (tickets ?? []).filter((t) => !dismissed.has(t.key));
  const queued = visible.filter(
    (t) =>
      !t.doneAt &&
      (t.canceled || t.tasks.every((x) => x.status === 'QUEUED' || x.status === 'CANCELED')),
  );
  const preparing = visible.filter((t) => !t.doneAt && !queued.includes(t));
  const done = visible.filter((t) => t.doneAt).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!));
  const totals = consolidate(
    visible.flatMap((t) =>
      t.tasks.map((x) => ({
        name: x.name,
        size: x.details.size,
        quantity: x.quantity,
        status: x.status,
      })),
    ),
  );
  const many = sectorIds.length > 1;
  const card = (ticket: KdsTicketDto) => (
    <TicketCard
      key={ticket.key}
      ticket={ticket}
      sector={sectorById.get(ticket.sectorId)}
      sectorName={many ? sectorById.get(ticket.sectorId)?.name : undefined}
      now={serverNow}
      actions={actions}
      onDismiss={() => setDismissed((d) => new Set(d).add(ticket.key))}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col">
      {!started && (
        <button
          type="button"
          onClick={() => void start()}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 text-center"
        >
          <ChefHat className="size-20 text-primary" />
          <span className="text-4xl font-bold">Toque para iniciar</span>
          <span className="max-w-md text-lg text-muted-foreground">
            Ativa o som dos tickets novos e dos cancelamentos, a tela cheia e mantém a tela acesa.
          </span>
        </button>
      )}

      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="mr-2 min-w-0">
          <p className="truncate text-lg font-bold">{device?.name ?? 'Cozinha'}</p>
          <p className="truncate text-sm text-muted-foreground">{storeName}</p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Setores">
          {(sectors.data ?? []).map((s) => (
            <Button
              key={s.id}
              variant={view?.includes(s.id) ? 'default' : 'outline'}
              className="h-11 text-base"
              aria-pressed={view?.includes(s.id)}
              onClick={() => chooseView(s.id)}
            >
              {s.name}
            </Button>
          ))}
          {canExpedite && (
            <Button
              variant={expedition ? 'default' : 'outline'}
              className="h-11 text-base"
              aria-pressed={expedition}
              onClick={() => chooseView(EXPEDITION)}
            >
              <PackageCheck /> Expedição
            </Button>
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!expedition && (
            <>
              <Button
                variant={consolidated ? 'secondary' : 'ghost'}
                className="h-11"
                aria-pressed={consolidated}
                onClick={() => setConsolidated((v) => !v)}
              >
                <Layers /> Consolidado
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setSoldOut(true)}>
                <Ban /> Acabou
              </Button>
            </>
          )}
          <span
            role="status"
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 text-sm',
              realtime === 'online' ? 'text-success' : 'bg-destructive/15 text-destructive',
            )}
          >
            {realtime === 'online' ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
            {realtime === 'online' ? 'Ao vivo' : 'Reconectando...'}
          </span>
          <span
            className="flex items-center gap-1 text-sm text-muted-foreground"
            title={awake ? 'Tela sempre acesa' : undefined}
          >
            {sound.enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Tela cheia"
            onClick={() => void toggleFullscreen()}
          >
            <Expand />
          </Button>
          <Button
            variant="ghost"
            className="h-11"
            onClick={() =>
              void (mode.kind === 'device'
                ? signOut().then(() => router.replace('/kds/vincular'))
                : router.push('/pedidos'))
            }
          >
            <LogOut /> {mode.kind === 'device' ? 'Desvincular' : 'Sair'}
          </Button>
        </div>
      </header>

      <main className="flex flex-1 gap-4 p-4">
        {expedition ? (
          <div className="flex-1">
            {expeditionData.data ? (
              <ExpeditionBoard
                data={expeditionData.data}
                now={serverNow}
                busy={busy}
                onServe={(order: KdsExpeditionOrderDto, roundIds) =>
                  void run(
                    () => serveRounds(order.orderId, roundIds),
                    `Pedido #${order.number} entregue`,
                  )
                }
                onDispatch={(order, courierId) =>
                  // A stale version (409) shows the message and the data reloads.
                  void run(
                    () => dispatchOrder(order.orderId, order.version, courierId),
                    `Pedido #${order.number} saiu para entrega`,
                  )
                }
              />
            ) : (
              <Skeleton className="h-64" />
            )}
          </div>
        ) : (
          <>
            <div className="grid flex-1 grid-cols-1 gap-4 md:grid-cols-3">
              <Column title="Na fila" count={queued.length}>
                {queued.map(card)}
              </Column>
              <Column title="Em preparo" count={preparing.length}>
                {preparing.map(card)}
              </Column>
              <Column title="Pronto (recentes)" count={done.length}>
                {done.map(card)}
              </Column>
            </div>
            {consolidated && (
              <aside
                className="w-64 shrink-0 space-y-2 rounded-xl border bg-card p-3"
                aria-label="Consolidado"
              >
                <h2 className="text-lg font-semibold">Para preparar</h2>
                {totals.length === 0 && <p className="text-muted-foreground">Nada pendente.</p>}
                <ul className="space-y-1">
                  {totals.map((t) => (
                    <li key={t.name} className="flex justify-between gap-2 text-lg">
                      <span className="min-w-0 truncate">{t.name}</span>
                      <span className="tabular font-bold">{t.quantity}×</span>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </>
        )}
      </main>
      <SoldOutDialog open={soldOut} onOpenChange={setSoldOut} sectorIds={sectorIds} />
    </div>
  );
}
