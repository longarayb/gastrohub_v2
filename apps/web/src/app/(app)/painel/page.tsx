'use client';

import { DayDashboard } from '@/components/reports/day-dashboard';

/** Dashboard of the day (D038), first screen of owners and managers. */
export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <DayDashboard />
    </div>
  );
}
