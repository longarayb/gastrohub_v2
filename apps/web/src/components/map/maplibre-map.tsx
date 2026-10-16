'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { cn } from '@app/ui/lib/utils';
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MapLineTone, MapPin, MapViewProps } from './map-view';

/**
 * OpenFreeMap (no key, OpenStreetMap attribution) unless the environment names other styles. The
 * dark style follows the panel's dark theme (street names light on a dark background).
 */
const STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK_URL || 'https://tiles.openfreemap.org/styles/dark';

const isDark = () => document.documentElement.classList.contains('dark');

/**
 * The dark base style draws street and place names dim: on the panel they must read at a
 * glance, so every label gets the theme's foreground with a dark halo.
 */
function brightenLabels(map: MlMap): void {
  const text = tokenColor('--foreground');
  const halo = tokenColor('--background');
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type !== 'symbol' || !layer.layout?.['text-field']) continue;
    map.setPaintProperty(layer.id, 'text-color', text);
    map.setPaintProperty(layer.id, 'text-halo-color', halo);
    map.setPaintProperty(layer.id, 'text-halo-width', 1.5);
  }
}

const TONE_TOKENS: Record<MapLineTone, string> = {
  primary: '--primary',
  dispatched: '--status-dispatched',
  muted: '--muted-foreground',
};

/** The canvas cannot read CSS variables: the theme token is resolved when drawing. */
const tokenColor = (token: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(token).trim() || '#64748b';

/** Theme switches (class on <html>) redraw the lines with the new colors. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return version;
}

function PinBody({ pin, dragged }: { pin: MapPin; dragged: React.RefObject<boolean> }) {
  if (!pin.onClick) {
    return (
      <div role="img" aria-label={pin.label}>
        {pin.content}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={pin.label}
      className="block cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={(event) => {
        event.stopPropagation();
        // The click that ends a drag is not a selection.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        pin.onClick?.();
      }}
    >
      {pin.content}
    </button>
  );
}

interface Entry {
  marker: Marker;
  element: HTMLDivElement;
  dragged: { current: boolean };
}

export default function MaplibreMap({
  center,
  pins,
  lines,
  fitKey,
  onMapClick,
  className,
  'aria-label': ariaLabel,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const entries = useRef(new Map<string, Entry>());
  const [mounted, setMounted] = useState<[string, Entry][]>([]);
  const latestPins = useRef(new Map<string, MapPin>());
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const initialCenter = useRef(center);
  const theme = useThemeVersion();
  // Bumped when a style finished loading: the lines are added again (a new style drops them).
  const [styleVersion, setStyleVersion] = useState(0);
  const styleDark = useRef<boolean | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const instance = new maplibregl.Map({
      container: el,
      style: isDark() ? DARK_STYLE_URL : STYLE_URL,
      center: [initialCenter.current.longitude, initialCenter.current.latitude],
      zoom: 14,
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    styleDark.current = isDark();
    instance.on('load', () => setLoaded(true));
    instance.on('style.load', () => {
      if (styleDark.current) brightenLabels(instance);
      setStyleVersion((v) => v + 1);
    });
    instance.on('click', (e) =>
      clickRef.current?.({ latitude: e.lngLat.lat, longitude: e.lngLat.lng }),
    );
    // The panel changes size without the window changing (tabs, side list).
    const resize = new ResizeObserver(() => instance.resize());
    resize.observe(el);
    setMap(instance);
    const current = entries.current;
    return () => {
      resize.disconnect();
      instance.remove();
      current.clear();
      setMounted([]);
      setLoaded(false);
      setMap(null);
    };
  }, []);

  // Pins: markers with React content (portals), kept between renders.
  useEffect(() => {
    if (!map) return;
    let changed = false;
    const seen = new Set<string>();
    for (const pin of pins) {
      seen.add(pin.id);
      latestPins.current.set(pin.id, pin);
      const at: [number, number] = [pin.position.longitude, pin.position.latitude];
      const entry = entries.current.get(pin.id);
      if (entry) {
        // While dragging, the pin follows the pointer, not the data.
        if (!entry.dragged.current) entry.marker.setLngLat(at);
        entry.marker.setDraggable(!!pin.draggable);
        entry.element.style.zIndex = String(pin.layer ?? 0);
        continue;
      }
      const element = document.createElement('div');
      element.style.zIndex = String(pin.layer ?? 0);
      const dragged = { current: false };
      const marker = new maplibregl.Marker({ element, draggable: !!pin.draggable })
        .setLngLat(at)
        .addTo(map);
      // Our content is the control (button with the label); the wrapper must not be one too.
      for (const attr of ['role', 'tabindex', 'aria-label']) element.removeAttribute(attr);
      marker.on('dragstart', () => {
        dragged.current = true;
      });
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        latestPins.current.get(pin.id)?.onDragEnd?.({ latitude: p.lat, longitude: p.lng });
        // A drag that ends outside the pin produces no click to reset the flag.
        setTimeout(() => (dragged.current = false), 0);
      });
      entries.current.set(pin.id, { marker, element, dragged });
      changed = true;
    }
    for (const [id, entry] of entries.current) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      entries.current.delete(id);
      latestPins.current.delete(id);
      changed = true;
    }
    if (changed) setMounted([...entries.current]);
  }, [map, pins]);

  // Theme switch: the base map follows (light or dark style).
  useEffect(() => {
    if (!map || styleDark.current === null) return;
    const dark = isDark();
    if (dark === styleDark.current) return;
    styleDark.current = dark;
    map.setStyle(dark ? DARK_STYLE_URL : STYLE_URL);
  }, [map, theme]);

  // Lines: one GeoJSON source and layer each, redrawn when they or the theme change.
  const lineIds = useRef(new Set<string>());
  useEffect(() => {
    if (!map || !loaded) return;
    try {
      for (const id of lineIds.current) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
      lineIds.current.clear();
      for (const line of lines) {
        if (line.coordinates.length < 2) continue;
        const id = `line-${line.id}`;
        const data = {
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: line.coordinates },
        };
        const source = map.getSource(id) as GeoJSONSource | undefined;
        if (source) source.setData(data);
        else map.addSource(id, { type: 'geojson', data });
        map.addLayer({
          id,
          type: 'line',
          source: id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': tokenColor(TONE_TOKENS[line.tone]),
            'line-width': line.tone === 'muted' ? 3 : 5,
            'line-opacity': 0.85,
            ...(line.dashed && { 'line-dasharray': [1.5, 1.5] }),
          },
        });
        lineIds.current.add(id);
      }
    } catch {
      // A new style is still loading (theme switch): its `style.load` draws the lines again.
    }
  }, [map, loaded, lines, theme, styleVersion]);

  // Fit everything in view when the caller says so (first load, new suggestion).
  const latestGeometry = useRef({ pins, lines });
  latestGeometry.current = { pins, lines };
  useEffect(() => {
    if (!map || !loaded || !fitKey) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const pin of latestGeometry.current.pins) {
      bounds.extend([pin.position.longitude, pin.position.latitude]);
    }
    for (const line of latestGeometry.current.lines) {
      for (const point of line.coordinates) bounds.extend(point);
    }
    if (bounds.isEmpty()) return;
    map.fitBounds(bounds, { padding: 64, maxZoom: 16, duration: 400 });
  }, [map, loaded, fitKey]);

  useEffect(() => {
    if (map) map.getCanvas().style.cursor = onMapClick ? 'crosshair' : '';
  }, [map, onMapClick]);

  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={ariaLabel}
      className={cn('relative size-full overflow-hidden rounded-card border bg-muted', className)}
    >
      {mounted.map(([id, entry]) => {
        const pin = byId.get(id);
        return pin
          ? createPortal(<PinBody pin={pin} dragged={entry.dragged} />, entry.element, id)
          : null;
      })}
    </div>
  );
}
