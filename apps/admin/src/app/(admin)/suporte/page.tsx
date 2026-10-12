'use client';

import { SUPPORT_ACCESS_MODE_LABELS, formatDateTime, formatTime } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { toast } from '@app/ui/components/sonner';
import { EmptyState, ListSkeleton } from '@app/ui/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@app/ui/components/table';
import { Headset } from 'lucide-react';
import Link from 'next/link';
import { Page } from '@/components/page';
import { apiPost, errorMessage } from '@/lib/api';
import { useRefresh, useSupportSessions } from '@/lib/queries';

/** Support sessions (D041). New ones start from the customer page ("Acessar como suporte"). */
export default function SupportPage() {
  const { data, isLoading } = useSupportSessions();
  const refresh = useRefresh();

  return (
    <Page
      title="Acessos de suporte"
      description="Cada acesso tem motivo, prazo e aviso para o cliente. Para iniciar, abra o cliente e escolha a unidade."
    >
      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : !data?.length ? (
        <EmptyState icon={Headset} title="Nenhum acesso de suporte ainda" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente / unidade</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link
                    href={`/clientes/${s.organizationId}` as never}
                    className="font-semibold hover:underline"
                  >
                    {s.customerName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {s.storeName} · {s.adminName}
                  </p>
                </TableCell>
                <TableCell className="max-w-80 text-sm">{s.reason}</TableCell>
                <TableCell>
                  <Badge variant={s.mode === 'READ_WRITE' ? 'warning' : 'outline'}>
                    {SUPPORT_ACCESS_MODE_LABELS[s.mode]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {formatDateTime(s.startedAt)} até {formatTime(s.endedAt ?? s.endsAt)}
                  {s.active && (
                    <Badge variant="info" className="ml-2">
                      Em andamento
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {s.active && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await apiPost(`/support-sessions/${s.id}/end`);
                          toast.success('Acesso encerrado');
                        } catch (error) {
                          toast.error(errorMessage(error));
                        } finally {
                          await refresh();
                        }
                      }}
                    >
                      Encerrar agora
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Page>
  );
}
