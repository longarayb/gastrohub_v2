'use client';

import type { CourierAppDto, GeoPointDto } from '@app/shared';
import { cn } from '@app/ui/lib/utils';
import { Check, Navigation, X } from 'lucide-react';
import { useMemo } from 'react';
import { StorePin } from '@/components/dispatch/pins';
import { type MapLine, type MapPin, MapView } from '@/components/map/map-view';

type Run = NonNullable<CourierAppDto['run']>;

/** The courier's own route on the map: the store, the stops in order and where the phone is. */
export function CourierRouteMap({ run, position }: { run: Run; position: GeoPointDto | null }) {
  const pins = useMemo<MapPin[]>(() => {
    const list: MapPin[] = [];
    if (run.store) {
      list.push({ id: 'store', position: run.store, label: 'Loja', content: <StorePin /> });
    }
    run.stops.forEach((stop, i) => {
      if (!stop.location) return;
      const pending = stop.status === 'PENDING';
      list.push({
        id: stop.stopId,
        position: stop.location,
        label: `${i + 1}ª parada, pedido ${stop.orderNumber}${pending ? '' : ', concluída'}`,
        layer: pending ? 2 : 1,
        content: (
          <span
            className={cn(
              'flex h-9 min-w-9 items-center justify-center gap-0.5 rounded-full border-[3px] bg-card px-2 text-sm font-extrabold shadow-md',
              pending
                ? 'border-status-dispatched text-foreground'
                : 'border-muted-foreground text-muted-foreground',
            )}
          >
            {stop.status === 'DELIVERED' && <Check className="size-3.5" aria-hidden />}
            {stop.status === 'FAILED' && <X className="size-3.5" aria-hidden />}
            {i + 1}
          </span>
        ),
      });
    });
    if (position) {
      list.push({
        id: 'me',
        position,
        label: 'Você',
        layer: 3,
        content: (
          <span className="flex size-9 items-center justify-center rounded-full border-[3px] border-card bg-primary text-primary-foreground shadow-md">
            <Navigation className="size-4" aria-hidden />
          </span>
        ),
      });
    }
    return list;
  }, [run, position]);

  const lines = useMemo<MapLine[]>(
    () => (run.geometry ? [{ id: 'route', coordinates: run.geometry, tone: 'dispatched' }] : []),
    [run.geometry],
  );

  const center = run.store ?? run.stops.find((s) => s.location)?.location ?? position;
  if (!center) return null;
  return (
    <div className="h-72 sm:h-96">
      <MapView
        aria-label="Mapa da sua rota"
        center={center}
        pins={pins}
        lines={lines}
        fitKey={run.id}
      />
    </div>
  );
}
