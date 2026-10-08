'use client';

import {
  PRINT_JOB_KIND_LABELS,
  PRINT_JOB_STATUS_LABELS,
  type PrintJobDto,
  formatDateTime,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { Skeleton } from '@app/ui/components/misc';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Eye } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { printKeys, reprintJob, usePrintJobs } from '@/lib/printing';
import { JobPreview } from './preview';

const STATUS_VARIANT: Record<
  PrintJobDto['status'],
  'success' | 'secondary' | 'warning' | 'destructive' | 'info'
> = {
  PRINTED: 'success',
  PENDING: 'secondary',
  LEASED: 'info',
  HELD: 'warning',
  DISCARDED: 'destructive',
};

/** Recent prints with a preview of what went to the paper and a "2ª via". */
export function PrintQueueList({ orderId, empty }: { orderId?: string; empty?: string }) {
  const queryClient = useQueryClient();
  const { data: jobs, isLoading } = usePrintJobs(orderId);
  const [open, setOpen] = useState<string | null>(null);

  async function reprint(job: PrintJobDto) {
    try {
      await reprintJob(job.id);
      await queryClient.invalidateQueries({ queryKey: printKeys.all });
      toast.success('2ª via enviada para impressão');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  if (isLoading) return <Skeleton className="h-24" />;
  if (!jobs?.length) {
    return <p className="text-sm text-muted-foreground">{empty ?? 'Nada impresso ainda.'}</p>;
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {jobs.map((job) => (
        <li key={job.id} className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-40 flex-1">
              <p className="font-medium">
                {job.title}
                {job.reprintOfId && <span className="text-muted-foreground"> · 2ª via</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {PRINT_JOB_KIND_LABELS[job.kind]} · {job.printerName} ·{' '}
                {formatDateTime(job.printedAt ?? job.createdAt)}
              </p>
              {job.lastError && job.status !== 'PRINTED' && (
                <p className="text-xs text-destructive">{job.lastError}</p>
              )}
            </div>
            <Badge variant={STATUS_VARIANT[job.status]}>
              {PRINT_JOB_STATUS_LABELS[job.status]}
            </Badge>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Ver ${job.title}`}
              onClick={() => setOpen((id) => (id === job.id ? null : job.id))}
            >
              <Eye />
            </Button>
            {job.kind !== 'TEST_PAGE' && (
              <Button size="sm" variant="outline" onClick={() => void reprint(job)}>
                <Copy /> 2ª via
              </Button>
            )}
          </div>
          {open === job.id && <JobPreview jobId={job.id} />}
        </li>
      ))}
    </ul>
  );
}

export function PrintQueueCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Últimas impressões</CardTitle>
        <CardDescription>
          Toda impressão fica registrada. A 2ª via sai marcada como tal, para ninguém fazer o pedido
          duas vezes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PrintQueueList />
      </CardContent>
    </Card>
  );
}
