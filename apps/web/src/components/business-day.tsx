'use client';

import { formatLongDate, formatShortDate } from '@/lib/reports';
import { useBusinessToday } from '@/lib/stores';

/** "quarta-feira, 8 de outubro · dia de negócio 08/10" (page header, docs/DESIGN.md). */
export function BusinessDayLine() {
  const today = useBusinessToday();
  if (!today) return <span aria-hidden>&nbsp;</span>;
  return (
    <span className="first-letter:uppercase">
      {formatLongDate(today)} · dia de negócio {formatShortDate(today)}
    </span>
  );
}
