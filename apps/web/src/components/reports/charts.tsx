'use client';

import { cn } from '@app/ui/lib/utils';
import Link from 'next/link';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { TONES, type Tone } from './kpi';

// ---------------------------------------------------------------------------
// BarList

export interface BarListRow {
  key: string;
  label: ReactNode;
  value: number;
  /** Main value shown (bold) and the secondary one (muted). */
  primary: ReactNode;
  secondary?: ReactNode;
}

/** Rows with a 26 px track and a bar proportional to the largest value (docs/DESIGN.md). */
export function BarList({ rows, tone = 'blue' }: { rows: BarListRow[]; tone?: Tone }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nada no período.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
        >
          <span className="truncate text-sm font-semibold">{r.label}</span>
          <span className="tabular text-right text-sm">
            <b>{r.primary}</b>
            {r.secondary && <span className="ml-2 text-muted-foreground">{r.secondary}</span>}
          </span>
          <div className="col-span-2 h-[26px] overflow-hidden rounded-lg bg-track" aria-hidden>
            <div
              className={cn('h-full rounded-lg', TONES[tone].bar)}
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Columns by hour (today vs comparison)

/**
 * Side-by-side columns per hour: today in the accent, the comparison in `chart-compare` with a
 * 2 px cap (contrast ≥ 3:1). Only hours with movement are drawn; narrow screens scroll inside.
 */
export function HourColumns({
  today,
  compare,
  todayLabel,
  compareLabel,
}: {
  today: number[];
  compare: number[];
  todayLabel: string;
  compareLabel: string;
}) {
  const active = today
    .map((v, h) => ({ h, today: v, compare: compare[h] ?? 0 }))
    .filter((x) => x.today > 0 || x.compare > 0);
  if (!active.length) return <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>;
  // Fill the gaps between the first and last hour with movement (closed hours show empty).
  const first = active[0]!.h;
  const last = active.at(-1)!.h;
  const hours = Array.from({ length: last - first + 1 }, (_, i) => {
    const h = first + i;
    return { h, today: today[h] ?? 0, compare: compare[h] ?? 0 };
  });
  const max = Math.max(1, ...hours.flatMap((x) => [x.today, x.compare]));
  const height = 160;
  const group = 44;
  const bar = 16;
  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-4 text-sm" aria-hidden>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-chart-1" /> {todayLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm border-t-2 border-chart-compare-cap bg-chart-compare" />{' '}
          {compareLabel}
        </span>
      </div>
      <div className="overflow-x-auto pb-1">
        <svg
          role="img"
          aria-label={`Pedidos por hora: ${todayLabel} e ${compareLabel}`}
          width={hours.length * group}
          height={height + 24}
          className="block"
        >
          {hours.map((x, i) => {
            const t = (x.today / max) * height;
            const c = (x.compare / max) * height;
            const left = i * group + 4;
            return (
              <g key={x.h}>
                <rect
                  x={left}
                  y={height - t}
                  width={bar}
                  height={t}
                  rx={3}
                  className="fill-chart-1"
                >
                  <title>{`${x.h}h · ${todayLabel}: ${x.today}`}</title>
                </rect>
                <rect
                  x={left + bar + 2}
                  y={height - c}
                  width={bar}
                  height={c}
                  rx={3}
                  className="fill-chart-compare"
                >
                  <title>{`${x.h}h · ${compareLabel}: ${x.compare}`}</title>
                </rect>
                {c > 0 && (
                  <rect
                    x={left + bar + 2}
                    y={height - c}
                    width={bar}
                    height={2}
                    className="fill-chart-compare-cap"
                  />
                )}
                <text
                  x={left + bar}
                  y={height + 16}
                  textAnchor="middle"
                  className="tabular fill-muted-foreground text-[11px]"
                >
                  {x.h}h
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <table className="sr-only">
        <caption>Pedidos por hora</caption>
        <thead>
          <tr>
            <th>Hora</th>
            <th>{todayLabel}</th>
            <th>{compareLabel}</th>
          </tr>
        </thead>
        <tbody>
          {hours.map((x) => (
            <tr key={x.h}>
              <td>{x.h}h</td>
              <td>{x.today}</td>
              <td>{x.compare}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Heatmap (weekday × hour)

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Intensity by the accent color (color-mix), with the value in each cell's title and table. */
export function Heatmap({ grid, format }: { grid: number[][]; format: (v: number) => string }) {
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) =>
    grid.some((row) => (row[h] ?? 0) > 0),
  );
  const max = Math.max(1, ...grid.flat());
  if (!hours.length) return <p className="text-sm text-muted-foreground">Nada no período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <caption className="sr-only">Mapa de calor por dia da semana e hora</caption>
        <thead>
          <tr>
            <th className="sr-only">Dia</th>
            {hours.map((h) => (
              <th key={h} scope="col" className="tabular w-9 font-normal text-muted-foreground">
                {h}h
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, weekday) => (
            <tr key={weekday}>
              <th scope="row" className="pr-2 text-left font-semibold">
                {WEEKDAYS[weekday]}
              </th>
              {hours.map((h) => {
                const v = row[h] ?? 0;
                const pct = Math.round((v / max) * 100);
                return (
                  <td
                    key={h}
                    title={`${WEEKDAYS[weekday]} ${h}h: ${format(v)}`}
                    className="tabular h-9 w-9 rounded-md bg-track text-center"
                    style={
                      v
                        ? {
                            background: `color-mix(in oklab, var(--accent-blue) ${Math.max(12, pct)}%, var(--track))`,
                          }
                        : undefined
                    }
                  >
                    <span className="sr-only">{format(v)}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily columns (period)

export function DayColumns({
  days,
  format,
}: {
  days: { date: string; value: number; label: string }[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...days.map((d) => d.value));
  const height = 140;
  const width = Math.max(6, Math.min(28, Math.floor(900 / Math.max(days.length, 1)) - 2));
  if (!days.length) return <p className="text-sm text-muted-foreground">Nada no período.</p>;
  return (
    <div className="overflow-x-auto pb-1">
      <svg
        role="img"
        aria-label="Faturamento por dia"
        width={days.length * (width + 2)}
        height={height + 4}
        className="block"
      >
        {days.map((d, i) => {
          const h = (d.value / max) * height;
          return (
            <rect
              key={d.date}
              x={i * (width + 2)}
              y={height - h}
              width={width}
              height={h}
              rx={2}
              className="fill-chart-1"
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attention now

export interface AttentionItem {
  key: string;
  count: number;
  label: string;
  href: Route;
  /** Orange when there is something, red for critical, green when zero. */
  level: 'attention' | 'critical';
}

/** "Atenção agora": big colored numbers with their label, each one a link (docs/DESIGN.md). */
export function AttentionStrip({ items }: { items: AttentionItem[] }) {
  return (
    <section
      aria-label="Atenção agora"
      className="rounded-card border bg-card p-4 font-display md:p-5"
    >
      <h2 className="mb-3 text-lg font-bold">Atenção agora</h2>
      <ul className="flex flex-wrap gap-x-8 gap-y-3">
        {items.map((item) => {
          const color =
            item.count === 0
              ? 'text-signal-positive'
              : item.level === 'critical'
                ? 'text-signal-critical'
                : 'text-signal-attention';
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center gap-3 rounded-lg px-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn('tabular text-attention font-extrabold', color)}>
                  {item.count}
                </span>
                <span className="text-sm font-semibold">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
