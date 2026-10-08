'use client';

import {
  PRINTER_STATUS_LABELS,
  PRINT_JOB_KIND_LABELS,
  Permission,
  type PrintJobDto,
  type PrintStatusDto,
  agentOnline,
  formatDateTime,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@app/ui/components/sheet';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, Printer, RotateCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { decideHeldJob, printKeys, retryJob, usePrintStatus } from '@/lib/printing';
import { JobPreview } from './preview';

/** What is wrong right now, in plain words (same rules as the `alerts` count of the API). */
export function printProblems(status: PrintStatusDto, now = new Date()) {
  const used = new Set(status.printers.filter((p) => p.active).map((p) => p.agentId));
  return {
    offlineAgents: status.agents.filter(
      (a) => a.state === 'PAIRED' && used.has(a.id) && !agentOnline(a.lastSeenAt, now),
    ),
    printers: status.printers.filter(
      (p) => p.active && ['PAPER_OUT', 'OFFLINE', 'ERROR'].includes(p.status),
    ),
  };
}

function JobRow({ job, actions }: { job: PrintJobDto; actions: React.ReactNode }) {
  const [preview, setPreview] = useState(false);
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-40 flex-1">
          <p className="font-medium">{job.title}</p>
          <p className="text-xs text-muted-foreground">
            {PRINT_JOB_KIND_LABELS[job.kind]} · {job.printerName} · {formatDateTime(job.createdAt)}
          </p>
          {job.lastError && <p className="text-xs text-destructive">{job.lastError}</p>}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Ver ${job.title}`}
          onClick={() => setPreview((v) => !v)}
        >
          <Eye />
        </Button>
        {actions}
      </div>
      {preview && <JobPreview jobId={job.id} />}
    </li>
  );
}

/**
 * Printing alerts in the header (D036): offline computers, printers without paper or off,
 * jobs failing for a while and old jobs held for a decision (print as late or discard).
 */
export function PrintAlerts() {
  const { can } = useAuth();
  const allowed = can(Permission.PRINT);
  const queryClient = useQueryClient();
  const { data: status } = usePrintStatus(allowed);
  const [open, setOpen] = useState(false);
  if (!allowed || !status || (!status.printers.length && !status.held.length)) return null;
  const problems = printProblems(status);

  const run = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
      toast.success(done);
      await queryClient.invalidateQueries({ queryKey: printKeys.all });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={
          status.alerts ? `Impressão: ${status.alerts} alerta(s)` : 'Impressão funcionando'
        }
        onClick={() => setOpen(true)}
        className={status.alerts ? 'text-destructive' : 'text-muted-foreground'}
      >
        <Printer />
        {status.alerts > 0 && <Badge variant="destructive">{status.alerts}</Badge>}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Impressão</SheetTitle>
            <SheetDescription>
              {status.alerts
                ? 'Resolva os itens abaixo para nada deixar de sair na cozinha e no caixa.'
                : 'Tudo certo: computadores conectados e impressoras prontas.'}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6 text-sm">
            {problems.offlineAgents.length > 0 && (
              <section className="space-y-1">
                <h3 className="font-semibold">Computadores sem conexão</h3>
                {problems.offlineAgents.map((a) => (
                  <p key={a.id}>
                    <b>{a.name}</b>: confira se o computador está ligado e com internet.
                    {a.lastSeenAt && ` Último contato ${formatDateTime(a.lastSeenAt)}.`}
                  </p>
                ))}
              </section>
            )}
            {problems.printers.length > 0 && (
              <section className="space-y-1">
                <h3 className="font-semibold">Impressoras com problema</h3>
                {problems.printers.map((p) => (
                  <p key={p.id}>
                    <b>{p.name}</b>: {PRINTER_STATUS_LABELS[p.status]}
                    {p.statusDetail ? ` (${p.statusDetail})` : ''}
                  </p>
                ))}
              </section>
            )}
            {status.held.length > 0 && (
              <section className="space-y-1">
                <h3 className="font-semibold">Impressões retidas</h3>
                <p className="text-muted-foreground">
                  Ficaram muito tempo sem imprimir. Confira se ainda fazem sentido: imprimindo
                  agora, saem marcadas como atrasadas.
                </p>
                <ul className="divide-y rounded-md border">
                  {status.held.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      actions={
                        <>
                          <Button
                            size="sm"
                            onClick={() =>
                              run(() => decideHeldJob(job.id, 'PRINT'), 'Enviado para impressão')
                            }
                          >
                            <Printer /> Imprimir
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              run(() => decideHeldJob(job.id, 'DISCARD'), 'Impressão descartada')
                            }
                          >
                            <Trash2 /> Descartar
                          </Button>
                        </>
                      }
                    />
                  ))}
                </ul>
              </section>
            )}
            {status.failing.length > 0 && (
              <section className="space-y-1">
                <h3 className="font-semibold">Aguardando a impressora</h3>
                <p className="text-muted-foreground">
                  Saem sozinhas assim que o problema for resolvido. Nada se perde.
                </p>
                <ul className="divide-y rounded-md border">
                  {status.failing.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      actions={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => run(() => retryJob(job.id), 'Tentando de novo')}
                        >
                          <RotateCw /> Tentar agora
                        </Button>
                      }
                    />
                  ))}
                </ul>
              </section>
            )}
            {can(Permission.PRINTERS_MANAGE) && (
              <Button asChild variant="outline" onClick={() => setOpen(false)}>
                <Link href="/configuracoes/impressao">Configurar impressão</Link>
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
