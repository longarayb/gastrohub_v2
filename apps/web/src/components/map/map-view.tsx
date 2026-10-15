'use client';

import type { GeoPointDto, LineString } from '@app/shared';
import { Skeleton } from '@app/ui/components/misc';
import dynamic from 'next/dynamic';

/**
 * The panel's map (D048), independent of the provider: pins with our own content (React), lines
 * and clicks. Today MapLibre GL with the OpenFreeMap style (`maplibre-map.tsx`, loaded only on the
 * screens that show a map); changing provider = another implementation of these props.
 */
export interface MapPin {
  id: string;
  position: GeoPointDto;
  /** Read by screen readers (the pin content is drawn for the eyes). */
  label: string;
  content: React.ReactNode;
  draggable?: boolean;
  onClick?: () => void;
  onDragEnd?: (position: GeoPointDto) => void;
  /** Higher stays on top (selected orders, couriers). */
  layer?: number;
}

/** Colors come from the theme tokens (never loose colors). */
export type MapLineTone = 'primary' | 'dispatched' | 'muted';

export interface MapLine {
  id: string;
  coordinates: LineString;
  tone: MapLineTone;
  /** Straight-line estimate (no road route): dashed. */
  dashed?: boolean;
}

export interface MapViewProps {
  /** Initial center (the store); later the map keeps where the operator left it. */
  center: GeoPointDto;
  pins: MapPin[];
  lines: MapLine[];
  /** When it changes, the map fits everything in view (pins and lines). */
  fitKey?: string;
  /** Marking a point: crosshair cursor and the clicked position. */
  onMapClick?: (position: GeoPointDto) => void;
  className?: string;
  'aria-label': string;
}

export const MapView = dynamic<MapViewProps>(() => import('./maplibre-map'), {
  ssr: false,
  loading: () => <Skeleton className="size-full min-h-80 rounded-card" />,
});
