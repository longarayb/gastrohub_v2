'use client';

import {
  KDS_PAIRING_TTL_MINUTES,
  type PrintAgentDto,
  type PrintAgentPairingCodeDto,
  formatDateTime,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { toast } from '@app/ui/components/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, Laptop, Plus, Unplug } from 'lucide-react';
import { useId, useState } from 'react';
import { Field } from '@/components/form';
import { errorMessage } from '@/lib/api';
import {
  AGENT_DOWNLOAD_URL,
  agentPairingCode,
  createAgent,
  printKeys,
  revokeAgent,
} from '@/lib/printing';

function AgentState({ agent }: { agent: PrintAgentDto }) {
  if (agent.state === 'REVOKED') return <Badge variant="destructive">Desvinculado</Badge>;
  if (agent.state === 'PENDING') return <Badge variant="secondary">Aguardando vínculo</Badge>;
  return agent.online ? (
    <Badge variant="success">Conectado</Badge>
  ) : (
    <Badge variant="destructive">Sem conexão</Badge>
  );
}

function InstallSteps() {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm">
      <li>
        No computador ligado às impressoras (Windows 10 ou 11, 64 bits),{' '}
        {AGENT_DOWNLOAD_URL ? (
          <a className="underline" href={AGENT_DOWNLOAD_URL}>
            baixe o instalador
          </a>
        ) : (
          'execute o instalador de impressão (instalar-impressao.exe)'
        )}{' '}
        e avance até o fim.
      </li>
      <li>
        Ao terminar, abre a página <span className="font-mono">http://127.0.0.1:9180</span>. Digite
        o código da unidade e o código de vínculo abaixo.
      </li>
      <li>Pronto: o computador aparece como conectado aqui. Cadastre as impressoras dele.</li>
    </ol>
  );
}

function CodeDialog({
  code,
  onOpenChange,
}: {
  code: PrintAgentPairingCodeDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!code} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {code && (
          <>
            <DialogHeader>
              <DialogTitle>Vincular {code.agent.name}</DialogTitle>
              <DialogDescription>
                O código vale por {KDS_PAIRING_TTL_MINUTES} minutos e é invalidado após 5 tentativas
                erradas.
              </DialogDescription>
            </DialogHeader>
            <InstallSteps />
            <div className="space-y-2 text-center">
              <p className="text-sm text-muted-foreground">Código da unidade</p>
              <p className="font-mono text-2xl font-semibold">{code.storeSlug}</p>
              <p className="text-sm text-muted-foreground">Código de vínculo</p>
              <p
                className="tabular font-mono text-5xl font-bold tracking-[0.3em]"
                aria-label="Código de vínculo"
              >
                {code.code}
              </p>
              <p className="text-xs text-muted-foreground">
                Válido até {formatDateTime(code.expiresAt)}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Computers that print (D035): several per store, each with its own printers. */
export function AgentsCard({ agents }: { agents: PrintAgentDto[] }) {
  const queryClient = useQueryClient();
  const nameId = useId();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<PrintAgentPairingCodeDto | null>(null);
  const [revoking, setRevoking] = useState<PrintAgentDto | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: printKeys.all });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return toast.error('Informe um nome para o computador');
    setBusy(true);
    try {
      setCode(await createAgent(name.trim()));
      setAdding(false);
      setName('');
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(agent: PrintAgentDto) {
    try {
      setCode(await agentPairingCode(agent.id));
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const visible = agents.filter((a) => a.state !== 'REVOKED');
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Computadores que imprimem</CardTitle>
          <CardDescription>
            Cada computador com impressoras ligadas (no caixa, na cozinha) recebe o agente de
            impressão, que fica ativo junto com o Windows.
          </CardDescription>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> Adicionar computador
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!visible.length ? (
          <div className="space-y-3 text-sm">
            <p className="flex items-center gap-2 text-muted-foreground">
              <Laptop className="size-4" /> Nenhum computador vinculado. Sem ele, use a impressão
              pelo navegador.
            </p>
            {AGENT_DOWNLOAD_URL && (
              <Button asChild variant="outline" size="sm">
                <a href={AGENT_DOWNLOAD_URL}>
                  <Download /> Baixar instalador
                </a>
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {visible.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      a.hostname,
                      a.version && `versão ${a.version}`,
                      a.memoryMb != null && `memória ${Math.round(a.memoryMb)} MB`,
                      a.lastSeenAt && `último contato ${formatDateTime(a.lastSeenAt)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <AgentState agent={a} />
                <Button size="sm" variant="outline" onClick={() => void regenerate(a)}>
                  <KeyRound /> {a.state === 'PAIRED' ? 'Vincular outro computador' : 'Novo código'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setRevoking(a)}
                >
                  <Unplug /> Desvincular
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={add} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Adicionar computador</DialogTitle>
              <DialogDescription>
                Dê um nome que todos reconheçam. Em seguida aparece o código para vincular.
              </DialogDescription>
            </DialogHeader>
            <Field label="Nome" htmlFor={nameId}>
              <Input
                id={nameId}
                value={name}
                maxLength={60}
                placeholder="Ex.: PC do caixa"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <DialogFooter>
              <Button type="submit" loading={busy}>
                Criar e gerar código
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <CodeDialog code={code} onOpenChange={(o) => !o && setCode(null)} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(o) => !o && setRevoking(null)}
        title={`Desvincular ${revoking?.name}?`}
        description="O computador para de imprimir na hora. As impressoras dele ficam cadastradas; para usá-las de novo, vincule outro computador e mude as impressoras para ele."
        confirmLabel="Desvincular"
        destructive
        onConfirm={async () => {
          try {
            await revokeAgent(revoking!.id);
            await refresh();
            toast.success('Computador desvinculado');
          } catch (error) {
            toast.error(errorMessage(error));
          }
          setRevoking(null);
        }}
      />
    </Card>
  );
}
