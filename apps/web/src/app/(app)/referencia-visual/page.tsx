'use client';

import { ORDER_STATUSES, type OrderSummaryDto } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@app/ui/components/dialog';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@app/ui/components/dropdown-menu';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import {
  Skeleton,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@app/ui/components/misc';
import { Notice } from '@app/ui/components/notice';
import { Popover, PopoverContent, PopoverTrigger } from '@app/ui/components/popover';
import { Segmented } from '@app/ui/components/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@app/ui/components/sheet';
import { toast } from '@app/ui/components/sonner';
import { ListSkeleton, LoadingArea, ShortcutBar } from '@app/ui/components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@app/ui/components/table';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { AlarmClock, AlarmClockOff, Inbox, Info, Plus, Search, Smartphone } from 'lucide-react';
import { useTheme } from 'next-themes';
import { notFound } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BalanceFlag, CardFlag, StatusBadge } from '@/components/orders/common';
import { OrderCard } from '@/components/orders/order-card';
import { EmptyState, Page } from '@/components/page';

/**
 * Visual reference of the panel theme (feat/redesign, docs/DESIGN.md): every base component
 * and state, the color tokens with their measured contrast, both themes and the phone width.
 * Development only (NEXT_PUBLIC_UI_REFERENCE=1), owner only (lib/routes.ts).
 */

/** [token, what it is, background it sits on]. */
const TEXT_PAIRS: [string, string, string][] = [
  ['--foreground', 'Texto principal', '--card'],
  ['--muted-foreground', 'Texto apagado', '--card'],
  ['--muted-foreground', 'Texto apagado sobre o fundo', '--background'],
  ['--muted-foreground', 'Texto apagado sobre o trilho', '--track'],
  ['--primary', 'Azul principal (links)', '--card'],
  ['--primary-foreground', 'Texto do botão principal', '--primary'],
  ['--signal-critical', 'Crítico', '--card'],
  ['--signal-attention', 'Atenção', '--card'],
  ['--signal-positive', 'Positivo', '--card'],
  ['--status-pending', 'Status: pendente', '--card'],
  ['--status-accepted', 'Status: aceito', '--card'],
  ['--status-preparing', 'Status: em preparo', '--card'],
  ['--status-ready', 'Status: pronto', '--card'],
  ['--status-dispatched', 'Status: saiu', '--card'],
  ['--status-delivered', 'Status: entregue', '--card'],
  ['--status-canceled', 'Status: cancelado', '--card'],
  ['--nav-active-foreground', 'Item ativo do menu', '--nav-active'],
  ['--avatar-foreground', 'Inicial no avatar', '--avatar'],
  ['--warning-foreground', 'Texto sobre atenção', '--warning'],
  ['--destructive-foreground', 'Texto do botão de excluir', '--destructive'],
];
/** Non-text elements (WCAG 1.4.11): 3:1. */
const UI_PAIRS: [string, string, string][] = [
  ['--input', 'Borda dos campos', '--card'],
  ['--ring', 'Foco do teclado', '--card'],
  ['--ring', 'Foco do teclado sobre o fundo', '--background'],
  ['--chart-compare-cap', 'Traço da série comparativa', '--card'],
];

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

function ContrastTable({ pairs, min }: { pairs: [string, string, string][]; min: number }) {
  const { resolvedTheme } = useTheme();
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const read: Record<string, string> = {};
    for (const [fg, , bg] of pairs) {
      read[fg] = style.getPropertyValue(fg).trim();
      read[bg] = style.getPropertyValue(bg).trim();
    }
    setValues(read);
  }, [pairs, resolvedTheme]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-2 pr-3 font-bold">Combinação</th>
            <th className="py-2 pr-3 font-bold">Amostra</th>
            <th className="py-2 text-right font-bold">Contraste</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {pairs.map(([fg, label, bg]) => {
            const a = values[fg];
            const b = values[bg];
            const ratio = a?.startsWith('#') && b?.startsWith('#') ? contrast(a, b) : null;
            const ok = ratio !== null && ratio >= min;
            return (
              <tr key={`${fg}-${bg}-${label}`}>
                <td className="py-2 pr-3">
                  {label}
                  <span className="block text-xs text-muted-foreground">
                    {fg} sobre {bg}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  <span
                    className="inline-flex h-9 items-center rounded-md border px-3 font-bold"
                    style={{ color: `var(${fg})`, background: `var(${bg})` }}
                  >
                    R$ 1.234,56
                  </span>
                </td>
                <td className="py-2 text-right font-bold">
                  {ratio === null ? '—' : `${ratio.toFixed(2).replace('.', ',')} : 1`}{' '}
                  <span className={ok ? 'text-signal-positive' : 'text-signal-critical'}>
                    {ok ? '✓ AA' : '✗ abaixo'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const SAMPLE: OrderSummaryDto = {
  id: 'ref-1',
  number: 42,
  publicCode: 'REF42',
  businessDate: '2026-10-08',
  type: 'DELIVERY',
  source: 'DIGITAL_MENU',
  status: 'READY',
  version: 1,
  tableNames: [],
  tableSessionId: null,
  tabLabel: null,
  customerName: 'Mariana Souza',
  customerPhone: null,
  neighborhood: 'Bela Vista',
  courierName: 'Fábio',
  deliveryFailure: { reason: 'CUSTOMER_ABSENT', note: null, at: minutesAgo(6) },
  pixReportedAt: minutesAgo(20),
  itemCount: 3,
  draftItemCount: 0,
  totalCents: 8790,
  paidCents: 0,
  paymentStatus: 'UNPAID',
  balanceCents: 8790,
  // Area time of 30 min from acceptance: 2 minutes late.
  deadlineAt: minutesAgo(2),
  expectedPaymentMethod: 'PIX',
  notes: null,
  createdAt: minutesAgo(34),
  acceptedAt: minutesAgo(32),
  readyAt: minutesAgo(9),
  updatedAt: minutesAgo(6),
};
const SAMPLE_TABLE: OrderSummaryDto = {
  ...SAMPLE,
  id: 'ref-2',
  number: 17,
  type: 'DINE_IN',
  source: 'POS',
  status: 'PENDING',
  tableNames: ['2', '3'],
  tabLabel: 'Carlos',
  customerName: null,
  neighborhood: null,
  courierName: null,
  deliveryFailure: null,
  pixReportedAt: null,
  draftItemCount: 2,
  expectedPaymentMethod: null,
  deadlineAt: null,
  createdAt: minutesAgo(3),
};
const SAMPLE_TAKEOUT: OrderSummaryDto = {
  ...SAMPLE,
  id: 'ref-3',
  number: 23,
  type: 'TAKEOUT',
  source: 'POS',
  status: 'PREPARING',
  customerName: 'Balcão',
  neighborhood: null,
  courierName: null,
  deliveryFailure: null,
  pixReportedAt: null,
  totalCents: 4250,
  paidCents: 4250,
  paymentStatus: 'PAID',
  balanceCents: 0,
  expectedPaymentMethod: null,
  // Ready estimate in 4 minutes: attention.
  deadlineAt: new Date(Date.now() + 4 * 60_000).toISOString(),
  createdAt: minutesAgo(16),
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export default function VisualReferencePage() {
  if (process.env.NEXT_PUBLIC_UI_REFERENCE !== '1') notFound();
  const { theme = 'dark', setTheme } = useTheme();
  const [phone, setPhone] = useState(false);
  const [now] = useState(() => new Date());
  const [period, setPeriod] = useState<'today' | '7d' | '30d'>('today');
  const [confirming, setConfirming] = useState(false);

  return (
    <Page
      title="Referência visual"
      description="Componentes e cores do tema, para conferir os dois temas e a largura de celular. Só em desenvolvimento."
      actions={
        <>
          <Tabs value={theme} onValueChange={setTheme}>
            <TabsList aria-label="Tema">
              <TabsTrigger value="dark">Escuro</TabsTrigger>
              <TabsTrigger value="light">Claro</TabsTrigger>
              <TabsTrigger value="system">Sistema</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant={phone ? 'default' : 'outline'} onClick={() => setPhone((v) => !v)}>
            <Smartphone /> Largura de celular
          </Button>
        </>
      }
    >
      <div className={cn('space-y-6', phone && 'mx-auto max-w-[390px]')}>
        <Section title="Tipografia (Nunito Sans)">
          <p className="text-display font-extrabold">Título da página · 34 px</p>
          <p className="text-kpi font-extrabold">R$ 12.345,67</p>
          <p className="text-kpi-label font-bold tracking-[0.1em] text-muted-foreground uppercase">
            Rótulo do KPI · 13 px
          </p>
          <p className="text-base">Texto normal de 16 px, com algarismos tabulares: 1.111,11</p>
          <p className="text-sm text-muted-foreground">Linha de apoio · 14 px, cor apagada</p>
        </Section>

        <Section title="Contraste do texto (AA: 4,5 : 1)">
          <ContrastTable pairs={TEXT_PAIRS} min={4.5} />
        </Section>
        <Section title="Contraste de bordas, foco e gráficos (3 : 1)">
          <ContrastTable pairs={UI_PAIRS} min={3} />
        </Section>

        <Section title="Botões (44 px; o pequeno tem área de toque de 44 px)">
          <div className="flex flex-wrap gap-2">
            <Button>Principal</Button>
            <Button variant="secondary">Secundário</Button>
            <Button variant="outline">Contorno</Button>
            <Button variant="ghost">Discreto</Button>
            <Button variant="success">Confirmar</Button>
            <Button variant="destructive">Excluir</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Pequeno</Button>
            <Button>Padrão</Button>
            <Button size="lg">Grande</Button>
            <Button size="xl">Extra grande</Button>
            <Button size="icon" aria-label="Adicionar">
              <Plus />
            </Button>
            <Button loading>Carregando</Button>
            <Button disabled>Desabilitado</Button>
          </div>
        </Section>

        <Section title="Campos">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ref-name">Nome</Label>
              <Input id="ref-name" placeholder="Digite o nome" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ref-search">Busca com ícone</Label>
              <div className="relative">
                <Search
                  className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input id="ref-search" className="pl-10" placeholder="Número, cliente ou mesa" />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ref-error">Com erro</Label>
              <Input id="ref-error" aria-invalid defaultValue="abc" />
              <p className="text-sm text-destructive">Informe um valor válido</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ref-disabled">Desabilitado</Label>
              <Input id="ref-disabled" disabled defaultValue="Não editável" />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label htmlFor="ref-notes">Observação</Label>
              <Textarea id="ref-notes" placeholder="Sem cebola" />
            </div>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox defaultChecked /> Caixa de seleção
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <Switch defaultChecked /> Interruptor
            </Label>
          </div>
        </Section>

        <Section title="Abas">
          <Tabs defaultValue="ALL">
            <TabsList>
              <TabsTrigger value="ALL">Todos</TabsTrigger>
              <TabsTrigger value="DINE_IN">Mesa</TabsTrigger>
              <TabsTrigger value="TAKEOUT">Balcão/Retirada</TabsTrigger>
              <TabsTrigger value="DELIVERY">Delivery</TabsTrigger>
            </TabsList>
          </Tabs>
        </Section>

        <Section title="Status, badges e alertas (cor sempre com texto)">
          <div className="flex flex-wrap gap-2">
            {ORDER_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} type="DELIVERY" />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>Principal</Badge>
            <Badge variant="secondary">Secundário</Badge>
            <Badge variant="success">Pago</Badge>
            <Badge variant="warning">Atenção</Badge>
            <Badge variant="destructive">Cancelado</Badge>
            <Badge variant="outline">Contorno</Badge>
          </div>
          <div className="grid gap-2 md:max-w-sm">
            <CardFlag tone="critical" icon={AlarmClockOff}>
              Atrasado 6 min
            </CardFlag>
            <CardFlag tone="attention" icon={AlarmClock}>
              Prazo em 4 min
            </CardFlag>
            <CardFlag tone="critical">Não entregue · Cliente ausente · 19:42</CardFlag>
            <CardFlag tone="attention">2 não enviados</CardFlag>
            <BalanceFlag cents={8790} />
          </div>
        </Section>

        <Section title="Avisos na página">
          <Notice tone="info" title="Informação">
            O cardápio digital é atualizado em até 1 minuto.
          </Notice>
          <Notice tone="attention" title="Atenção">
            O texto do aviso de privacidade é um modelo: revise com apoio jurídico.
          </Notice>
          <Notice tone="critical" title="Erro">
            Não foi possível falar com a impressora da cozinha.
          </Notice>
          <Notice tone="success">Caixa fechado sem diferença.</Notice>
        </Section>

        <Section title="Controle segmentado e atalhos">
          <Segmented
            label="Período"
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'today', label: 'Hoje' },
              { value: '7d', label: '7 dias' },
              { value: '30d', label: '30 dias' },
            ]}
          />
          <ShortcutBar
            className="flex"
            items={[
              ['F2', 'Buscar'],
              ['F4', 'Receber'],
              ['F9', 'Criar pedido'],
              ['?', 'Atalhos'],
            ]}
          />
        </Section>

        <Section title="Tabela (vira cartões abaixo de 768 px)">
          <Table stack>
            <TableHeader>
              <TableRow>
                <TableHead>Cupom</TableHead>
                <TableHead>Desconto</TableHead>
                <TableHead className="text-right">Usos</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ['BEMVINDO', '10%', '42', 'Ativo'],
                ['FRETEGRATIS', 'R$ 8,00', '17', 'Pausado'],
              ].map(([code, value, uses, status]) => (
                <TableRow key={code}>
                  <TableCell label="Cupom" className="font-bold">
                    {code}
                  </TableCell>
                  <TableCell label="Desconto">{value}</TableCell>
                  <TableCell label="Usos" className="text-right">
                    {uses}
                  </TableCell>
                  <TableCell label="Status">
                    <Badge variant={status === 'Ativo' ? 'success' : 'secondary'}>{status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Seletores, menus e painéis">
          <div className="flex flex-wrap items-center gap-2">
            <Select defaultValue="pix">
              <SelectTrigger className="w-48" aria-label="Forma de pagamento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="card">Cartão</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Menu de ações</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Pedido #42</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Imprimir 2ª via</DropdownMenuItem>
                <DropdownMenuItem variant="destructive">Cancelar pedido</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Ajuda (popover)</Button>
              </PopoverTrigger>
              <PopoverContent>Faturamento: pedidos concluídos no dia de negócio.</PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Dica">
                  <Info />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Dica curta</TooltipContent>
            </Tooltip>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Painel lateral</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Pedido #42</SheetTitle>
                  <SheetDescription>Detalhes, pagamentos e histórico.</SheetDescription>
                </SheetHeader>
              </SheetContent>
            </Sheet>
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Confirmação
            </Button>
            <ConfirmDialog
              open={confirming}
              onOpenChange={setConfirming}
              title="Excluir o cupom BEMVINDO?"
              description="Ele deixa de valer nos próximos pedidos."
              confirmLabel="Excluir"
              destructive
              onConfirm={() => setConfirming(false)}
            />
          </div>
        </Section>

        <Section title="Cartões de pedido (kanban)">
          <div className="flex flex-wrap gap-4 rounded-card bg-track p-3">
            {[SAMPLE_TABLE, SAMPLE_TAKEOUT, SAMPLE].map((o, i) => (
              <div key={o.id} className="w-kanban-column max-w-full">
                <OrderCard
                  order={o}
                  now={now}
                  highlight={i === 0}
                  canAdvance
                  advancing={false}
                  onOpen={() => toast.info(`Pedido #${o.number}`)}
                  onAdvance={() => toast.success('Ação do cartão')}
                />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Avisos, diálogo, vazio e carregando">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => toast.success('Pedido aceito')}>
              Aviso de sucesso
            </Button>
            <Button variant="outline" onClick={() => toast.error('O pedido foi alterado')}>
              Aviso de erro
            </Button>
            <Button variant="outline" onClick={() => toast.warning('Impressora sem resposta')}>
              Aviso de atenção
            </Button>
            <Button variant="outline" onClick={() => toast.info('Nova versão disponível')}>
              Aviso informativo
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Abrir diálogo</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancelar pedido #42?</DialogTitle>
                  <DialogDescription>
                    O cliente é avisado e a cozinha para o preparo.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline">Voltar</Button>
                  <Button variant="destructive">Cancelar pedido</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <EmptyState
            icon={Inbox}
            title="Nenhum pedido"
            description="Os pedidos novos aparecem aqui."
          />
          <div className="grid gap-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24" />
          </div>
          <ListSkeleton rows={2} />
          <LoadingArea label="Carregando pedidos" />
        </Section>

        <Card>
          <CardHeader>
            <CardTitle>Cartão de página</CardTitle>
            <CardDescription>Raio de 18 px, borda fina, sem sombra.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </Page>
  );
}
