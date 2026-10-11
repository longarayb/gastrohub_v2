'use client';

import { formatDateTime } from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Segmented } from '@app/ui/components/segmented';
import { ListSkeleton } from '@app/ui/components/states';
import Link from 'next/link';
import { useState } from 'react';
import { Page } from '@/components/page';
import { AUDIT_FILTERS, actionLabel } from '@/lib/audit-labels';
import { useAudit } from '@/lib/queries';

/** Platform audit (D041): append-only record of everything the admins do, logins included. */
export default function AuditPage() {
  const [action, setAction] = useState<string>('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const before = cursors[cursors.length - 1] ?? null;
  const { data, isLoading } = useAudit(action, before);

  return (
    <Page
      title="Auditoria"
      description="Tudo o que é feito no painel da plataforma. Os registros não podem ser alterados nem apagados."
    >
      <Segmented
        label="Filtro"
        value={action}
        onChange={(v) => {
          setAction(v);
          setCursors([null]);
        }}
        options={AUDIT_FILTERS}
      />
      {isLoading || !data ? (
        <ListSkeleton rows={8} />
      ) : (
        <>
          <ul className="divide-y rounded-xl border">
            {data.items.map((e) => (
              <li key={e.seq} className="space-y-0.5 p-3 text-sm">
                <p className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <span className="font-semibold">{actionLabel(e.action)}</span>
                    {e.customerName && e.organizationId && (
                      <>
                        {' · '}
                        <Link
                          href={`/clientes/${e.organizationId}` as never}
                          className="hover:underline"
                        >
                          {e.customerName}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.adminName ?? e.actorEmail ?? 'Sistema'}
                  {e.ip ? ` · IP ${e.ip}` : ''}
                  {e.reason ? ` · Motivo: ${e.reason}` : ''}
                </p>
                {(e.before != null || e.after != null) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Detalhes</summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-muted p-2">
                      {JSON.stringify(
                        { antes: e.before ?? undefined, depois: e.after ?? undefined },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            {cursors.length > 1 && (
              <Button variant="outline" onClick={() => setCursors((c) => c.slice(0, -1))}>
                Mais recentes
              </Button>
            )}
            {data.next && (
              <Button variant="outline" onClick={() => setCursors((c) => [...c, data.next])}>
                Mais antigos
              </Button>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
