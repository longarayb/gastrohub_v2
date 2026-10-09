'use client';

import type { ReportScope } from '@app/shared';
import { Segmented } from '@app/ui/components/segmented';
import { PageHeader } from '@app/ui/components/states';
import type { ReactNode } from 'react';
import { useSession } from '@/lib/auth';

export { Segmented };

/** Page header of the dashboard and reports (docs/DESIGN.md): 34 px title, muted subtitle. */
export function ReportHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageHeader
      title={title}
      subtitle={<span className="block first-letter:uppercase">{subtitle}</span>}
      actions={actions}
    />
  );
}

/** The owner of several units can see the whole network (D038); others only their unit. */
export function useNetworkAvailable(): boolean {
  const session = useSession();
  return (
    session.role === 'OWNER' && session.memberships.filter((m) => m.role === 'OWNER').length > 1
  );
}

export function ScopeSwitch({
  value,
  onChange,
}: {
  value: ReportScope;
  onChange: (scope: ReportScope) => void;
}) {
  const available = useNetworkAvailable();
  if (!available) return null;
  return (
    <Segmented
      label="Unidades"
      value={value}
      onChange={onChange}
      options={[
        { value: 'STORE', label: 'Esta unidade' },
        { value: 'NETWORK', label: 'Todas as unidades' },
      ]}
    />
  );
}
