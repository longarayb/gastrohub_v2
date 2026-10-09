'use client';

import {
  type CatalogCategory,
  type CouponRule,
  type CreateOrderInput,
  type DiscountData,
  ORDER_TYPE_LABELS,
  type OrderType,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  Permission,
  calculateOrderTotals,
  createOrderSchema,
  defaultServiceFeeBps,
  effectiveDeliveryFeeCents,
  formatBRL,
  indexCatalog,
  normalizeSearch,
  salesChannelFor,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import { Input } from '@app/ui/components/input';
import { PriceLabel } from '@app/ui/components/menu-preview';
import { Label } from '@app/ui/components/label';
import { Separator, Skeleton, Tabs, TabsList, TabsTrigger } from '@app/ui/components/misc';
import { Kbd } from '@app/ui/components/states';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { ArrowLeft, Pizza, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  DeliveryQuoteField,
  EMPTY_DELIVERY_CHOICE,
  effectiveQuote,
  useDeliveryQuote,
} from '@/components/delivery/delivery-quote-field';
import { Field, MoneyInput } from '@/components/form';
import {
  CustomerSection,
  type CustomerState,
  EMPTY_CUSTOMER,
} from '@/components/orders/customer-section';
import {
  type BuilderTarget,
  type CartLine,
  ItemBuilderDialog,
} from '@/components/orders/item-builder-dialog';
import { ItemDescription, useOrderAction } from '@/components/orders/common';
import { DiscountInput } from '@/components/orders/order-discount-dialog';
import { Page } from '@/components/page';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useHotkeys } from '@/lib/hotkeys';
import { useCatalog } from '@/lib/menu';
import {
  addOrderItems,
  createOrder,
  orderTitle,
  useCoupons,
  useInvalidateOrders,
  useOrder,
  useTables,
} from '@/lib/orders';
import { useCurrentStore } from '@/lib/stores';

function issuesToErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.');
    errors[key] ??= issue.message;
  }
  return errors;
}

/**
 * Catalog of the composer. Keyboard: the search has the focus; ↑/↓ move through the products
 * shown (available ones), Enter opens the highlighted one (or the only result), Esc clears.
 */
function CatalogPicker({
  categories,
  onPick,
  searchRef,
}: {
  categories: CatalogCategory[];
  onPick: (target: BuilderTarget) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const term = normalizeSearch(q.trim());
  const visible = categories
    .filter((c) => categoryId === 'ALL' || c.id === categoryId)
    .map((category) => ({
      category,
      products: category.products.filter((p) => !term || normalizeSearch(p.name).includes(term)),
    }))
    .filter((c) => c.products.length);
  // What ↑/↓ walk through, in screen order.
  const choices = visible.flatMap(({ category, products }) =>
    products.filter((p) => p.availability.available).map((product) => ({ category, product })),
  );
  const activeChoice = choices[active] ?? null;
  const targetOf = ({ category, product }: (typeof choices)[number]): BuilderTarget =>
    category.kind === 'PIZZA'
      ? { kind: 'pizza', category }
      : { kind: 'product', product, category };

  // A new search or category starts from the first result.
  useEffect(() => setActive(term ? 0 : -1), [term, categoryId]);
  useEffect(() => {
    if (activeChoice) {
      document.getElementById(`produto-${activeChoice.product.id}`)?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [activeChoice]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!choices.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? 0 : (i + step + choices.length) % choices.length));
    } else if (e.key === 'Enter') {
      const choice = activeChoice ?? (choices.length === 1 ? choices[0] : null);
      if (choice) {
        e.preventDefault();
        onPick(targetOf(choice));
      }
    } else if (e.key === 'Escape' && q) {
      e.preventDefault();
      setQ('');
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={searchRef}
          autoFocus
          className="pl-10"
          placeholder="Buscar produto"
          aria-label="Buscar produto"
          aria-activedescendant={activeChoice ? `produto-${activeChoice.product.id}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorias">
        {[{ id: 'ALL', name: 'Todas' }, ...categories].map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={categoryId === c.id}
            onClick={() => setCategoryId(c.id)}
            className={cn(
              'h-11 shrink-0 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors',
              categoryId === c.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card hover:bg-accent',
            )}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="space-y-5">
        {visible.map(({ category, products }) => (
          <section key={category.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">{category.name}</h3>
              {category.kind === 'PIZZA' && (
                <Button size="sm" onClick={() => onPick({ kind: 'pizza', category })}>
                  <Pizza /> Montar pizza
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {products.map((p) => {
                const available = p.availability.available;
                const highlighted = activeChoice?.product.id === p.id;
                return (
                  <button
                    key={p.id}
                    id={`produto-${p.id}`}
                    type="button"
                    disabled={!available}
                    aria-current={highlighted || undefined}
                    onClick={() => onPick(targetOf({ category, product: p }))}
                    className={cn(
                      'flex min-h-20 flex-col justify-between gap-1 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent disabled:opacity-50',
                      highlighted && 'border-primary bg-accent outline-3 outline-ring',
                    )}
                  >
                    <span className="line-clamp-2 text-sm font-semibold">{p.name}</span>
                    {available ? (
                      <PriceLabel price={p.price} className="text-sm" />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {p.availability.reasons[0]?.message ?? 'Indisponível'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Shortcut hints (keyboard only: hidden on touch screens). */
function ShortcutBar({ items }: { items: [string, string][] }) {
  return (
    <p
      className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pointer-fine:flex"
      aria-label="Atalhos de teclado"
    >
      {items.map(([key, label]) => (
        <span key={key} className="inline-flex items-center gap-1">
          <Kbd>{key}</Kbd> {label}
        </span>
      ))}
    </p>
  );
}

function newKey() {
  return crypto.randomUUID();
}

function Composer() {
  const params = useSearchParams();
  const router = useRouter();
  const { can } = useAuth();
  const run = useOrderAction();
  const invalidate = useInvalidateOrders();
  const existingId = params.get('pedido');
  const back = params.get('origem') === 'mesas' ? '/mesas' : '/pedidos';
  const existing = useOrder(existingId);
  const { data: store } = useCurrentStore();
  const tables = useTables();
  const canDiscount = can(Permission.ORDERS_DISCOUNT);
  const coupons = useCoupons(canDiscount);

  const [type, setType] = useState<OrderType>(
    params.get('mesa') || existingId ? 'DINE_IN' : 'TAKEOUT',
  );
  const [tableId, setTableId] = useState(params.get('mesa') ?? '');
  const [tabLabel, setTabLabel] = useState('');
  const [customer, setCustomer] = useState<CustomerState>(EMPTY_CUSTOMER);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [builder, setBuilder] = useState<BuilderTarget | null>(null);
  const [sendNow, setSendNow] = useState(true);
  const [delivery, setDelivery] = useState(EMPTY_DELIVERY_CHOICE);
  const [orderDiscount, setOrderDiscount] = useState<DiscountData>({ type: 'VALUE', value: 0 });
  const [orderDiscountReason, setOrderDiscountReason] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [waiveFee, setWaiveFee] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [payment, setPayment] = useState<PaymentMethod | ''>('');
  const [changeFor, setChangeFor] = useState(0);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // One key per order being typed: a double click or a retry never creates two orders.
  const idempotencyKey = useRef(newKey());
  const ids = { tab: useId(), notes: useId(), coupon: useId(), discount: useId() };
  const searchRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  // After an item is added (or the dialog closed), back to the search for the next one.
  const builderOpen = !!builder;
  useEffect(() => {
    if (!builderOpen) {
      searchRef.current?.focus();
      searchRef.current?.select();
    }
  }, [builderOpen]);

  const order = existing.data;
  const effectiveType: OrderType = order ? order.type : type;
  const channel = salesChannelFor(effectiveType, 'POS');
  const catalog = useCatalog(channel);
  const index = useMemo(() => (catalog.data ? indexCatalog(catalog.data) : null), [catalog.data]);

  // Items priced for another channel must be re-added (prices/availability may differ).
  const lastChannel = useRef(channel);
  useEffect(() => {
    if (lastChannel.current !== channel && cart.length) {
      setCart([]);
      toast.info('Itens removidos: o cardápio muda conforme o tipo do pedido.');
    }
    lastChannel.current = channel;
  }, [channel, cart.length]);

  const coupon: CouponRule | null = useMemo(() => {
    const code = couponCode.trim().toUpperCase();
    const found = coupons.data?.find((c) => c.code === code && c.isActive);
    return found ?? null;
  }, [couponCode, coupons.data]);

  const serviceFeeBps =
    order || !store ? 0 : waiveFee ? 0 : defaultServiceFeeBps(effectiveType, store.settings);
  const isDelivery = !order && type === 'DELIVERY';
  const quoteState = useDeliveryQuote(
    customer.address,
    customer.addressId === 'new' ? null : customer.addressId,
    isDelivery,
  );
  const itemsSubtotal = calculateOrderTotals({
    lines: cart.map((l) => ({
      quantity: l.input.quantity,
      unitChargedPriceCents: l.pricing.unitChargedPriceCents,
      unitFullPriceCents: l.pricing.unitFullPriceCents,
      discount: l.input.discount,
    })),
    orderDiscount: null,
    coupon: null,
    serviceFeeBps: 0,
    deliveryFeeCents: 0,
  }).subtotalCents;
  const areaQuote = effectiveQuote(quoteState.quote, delivery, itemsSubtotal);
  const noAreas = !quoteState.quote || quoteState.quote.reason === 'NO_AREAS';
  const deliveryFee = isDelivery
    ? (delivery.feeCents ?? (noAreas ? 0 : (areaQuote?.quote.feeCents ?? 0)))
    : 0;
  const totals = calculateOrderTotals({
    lines: cart.map((l) => ({
      quantity: l.input.quantity,
      unitChargedPriceCents: l.pricing.unitChargedPriceCents,
      unitFullPriceCents: l.pricing.unitFullPriceCents,
      discount: l.input.discount,
    })),
    orderDiscount: !order && orderDiscount.value > 0 ? orderDiscount : null,
    coupon: order ? null : coupon,
    serviceFeeBps,
    deliveryFeeCents: order ? 0 : effectiveDeliveryFeeCents(effectiveType, deliveryFee),
  });
  const defaultFeeBps = store && !order ? defaultServiceFeeBps(effectiveType, store.settings) : 0;

  const activeTables = (tables.data ?? []).filter((t) => t.isActive);
  const selectedTable = activeTables.find((t) => t.id === tableId);

  function buildInput(): CreateOrderInput {
    const withCustomer = effectiveType === 'DELIVERY' || customer.phone || customer.name;
    return {
      type,
      tableId: type === 'DINE_IN' ? tableId || undefined : undefined,
      tabLabel: type === 'DINE_IN' ? tabLabel : null,
      customerId: customer.customerId ?? undefined,
      customer:
        withCustomer && !customer.customerId
          ? { name: customer.name, phone: customer.phone, document: null }
          : undefined,
      deliveryAddress: type === 'DELIVERY' ? customer.address : undefined,
      // Omitted = the fee of the area (the API resolves it again and audits a change).
      deliveryFeeCents:
        type === 'DELIVERY'
          ? noAreas
            ? (delivery.feeCents ?? 0)
            : (delivery.feeCents ?? undefined)
          : undefined,
      deliveryAreaId: type === 'DELIVERY' ? (delivery.areaId ?? undefined) : undefined,
      deliveryFeeReason: type === 'DELIVERY' ? delivery.reason.trim() || null : null,
      items: cart.map((l) => l.input),
      sendNow,
      orderDiscount: orderDiscount.value > 0 ? orderDiscount : null,
      orderDiscountReason: orderDiscount.value > 0 ? orderDiscountReason : null,
      couponCode: couponCode.trim() || null,
      waiveServiceFee: waiveFee,
      serviceFeeWaivedReason: waiveFee ? waiveReason : null,
      notes,
      expectedPaymentMethod: payment || null,
      changeForCents: payment === 'CASH' && changeFor > 0 ? changeFor : null,
    };
  }

  async function submit() {
    setErrors({});
    if (order) {
      if (!cart.length) return toast.error('Adicione pelo menos um item');
      setBusy(true);
      try {
        await run(
          () =>
            addOrderItems(order.id, {
              expectedVersion: order.version,
              items: cart.map((l) => l.input),
              send: sendNow,
            }),
          sendNow ? 'Itens enviados para a produção' : 'Itens lançados na conta',
        );
        router.push(back as never);
      } catch {
        // Toast already shown; on 409 the order reloads with the new version.
      } finally {
        setBusy(false);
      }
      return;
    }

    const input = buildInput();
    const parsed = createOrderSchema.safeParse(input);
    if (!parsed.success) {
      const found = issuesToErrors(parsed.error.issues);
      setErrors(found);
      return toast.error(Object.values(found)[0] ?? 'Revise os dados do pedido');
    }
    if (
      type === 'DELIVERY' &&
      !noAreas &&
      areaQuote &&
      delivery.feeCents != null &&
      delivery.feeCents < areaQuote.quote.feeCents &&
      delivery.reason.trim().length < 3
    ) {
      setErrors({ deliveryFeeReason: 'Informe o motivo para reduzir a taxa de entrega' });
      return toast.error('Informe o motivo para reduzir a taxa de entrega');
    }
    if (orderDiscount.value > 0 && orderDiscountReason.trim().length < 3) {
      setErrors({ orderDiscountReason: 'Informe o motivo do desconto' });
      return toast.error('Informe o motivo do desconto');
    }
    setBusy(true);
    try {
      const created = await createOrder(input, idempotencyKey.current);
      idempotencyKey.current = newKey();
      await invalidate();
      toast.success(`Pedido #${created.number} criado`);
      router.push(back as never);
    } catch (error) {
      if (error instanceof ApiError && Object.keys(error.fieldErrors).length) {
        setErrors(error.fieldErrors);
      }
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // Keyboard (shown on screen). Function keys work while typing; off while a dialog is open.
  const ORDER_TYPES = ['TAKEOUT', 'DELIVERY', 'DINE_IN'] as const;
  useHotkeys(
    {
      F2: () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
      F4: () => {
        if (!order) setType((t) => ORDER_TYPES[(ORDER_TYPES.indexOf(t) + 1) % ORDER_TYPES.length]!);
      },
      F6: () =>
        detailsRef.current?.querySelector<HTMLElement>('input, button[role="combobox"]')?.focus(),
      F7: () => document.getElementById(ids.notes)?.focus(),
      F9: () => {
        if (!busy) void submit();
      },
    },
    !builderOpen,
  );
  const submitLabel = order
    ? sendNow
      ? 'Enviar itens'
      : 'Lançar na conta'
    : type === 'DINE_IN'
      ? cart.length
        ? 'Abrir conta e enviar'
        : 'Abrir conta'
      : 'Criar pedido';
  const shortcuts: [string, string][] = [
    ['F2', 'Buscar'],
    ['↑↓', 'Escolher'],
    ['Enter', 'Abrir produto'],
    ...(order ? [] : ([['F4', 'Tipo']] as [string, string][])),
    ...(order ? [] : ([['F6', type === 'DINE_IN' ? 'Mesa' : 'Cliente']] as [string, string][])),
    ...(order ? [] : ([['F7', 'Observação']] as [string, string][])),
    ['F9', submitLabel],
  ];

  if (existingId && existing.isLoading) return <Skeleton className="m-6 h-96" />;

  return (
    <Page
      title={order ? `Adicionar itens · #${order.number}` : 'Novo pedido'}
      description={order ? orderTitle(order) : undefined}
      className="max-w-7xl"
      actions={
        <Button asChild variant="ghost">
          <Link href={back as never}>
            <ArrowLeft /> Voltar
          </Link>
        </Button>
      }
    >
      <ShortcutBar items={shortcuts} />
      <div className="grid gap-6 pb-24 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:pb-0">
        <div className="min-w-0">
          {!index ? (
            <Skeleton className="h-96" />
          ) : (
            <CatalogPicker
              categories={index.catalog.categories}
              onPick={setBuilder}
              searchRef={searchRef}
            />
          )}
        </div>

        <aside
          ref={summaryRef}
          aria-label="Resumo do pedido"
          className="scroll-mt-20 space-y-5 rounded-card border bg-card p-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto"
        >
          {!order && (
            <Tabs value={type} onValueChange={(v) => setType(v as OrderType)}>
              <TabsList className="w-full">
                {(['TAKEOUT', 'DELIVERY', 'DINE_IN'] as const).map((t) => (
                  <TabsTrigger key={t} value={t}>
                    {ORDER_TYPE_LABELS[t]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div ref={detailsRef} className="space-y-5 empty:hidden">
            {!order && type === 'DINE_IN' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Mesa" error={errors.tableId}>
                  <Select value={tableId} onValueChange={setTableId}>
                    <SelectTrigger aria-label="Mesa" className="w-full">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeTables.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                          {t.session ? ` · ${t.session.tabs.length} conta(s)` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Conta / cliente" htmlFor={ids.tab} error={errors.tabLabel}>
                  <Input
                    id={ids.tab}
                    placeholder="Ex.: João"
                    maxLength={60}
                    value={tabLabel}
                    onChange={(e) => setTabLabel(e.target.value)}
                  />
                </Field>
                {selectedTable?.session && (
                  <p className="col-span-2 text-xs text-muted-foreground">
                    Mesa ocupada: será aberta uma nova conta na mesma mesa.
                  </p>
                )}
              </div>
            )}

            {!order && type !== 'DINE_IN' && (
              <CustomerSection
                value={customer}
                onChange={setCustomer}
                withAddress={type === 'DELIVERY'}
                errors={errors}
              />
            )}
          </div>

          <Separator />

          <section className="space-y-2" aria-label="Itens do pedido">
            {cart.length === 0 ? (
              <p
                className={cn(
                  'text-sm',
                  errors.items ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {errors.items ?? 'Escolha os produtos no cardápio.'}
              </p>
            ) : (
              <ul className="divide-y">
                {cart.map((line) => (
                  <li key={line.key} className="flex items-start gap-2 py-2">
                    <span className="w-7 text-base font-extrabold">{line.input.quantity}×</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold">{line.pricing.snapshot.name}</p>
                      <ItemDescription item={{ snapshot: line.pricing.snapshot, notes: null }} />
                      {line.input.discount && (
                        <p className="text-xs text-muted-foreground">
                          Desconto: {line.input.discountReason}
                        </p>
                      )}
                    </div>
                    <span className="text-base font-bold">
                      {formatBRL(line.pricing.totalChargedCents)}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remover ${line.pricing.snapshot.name}`}
                      onClick={() => setCart((c) => c.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {effectiveType === 'DINE_IN' && (
            <Label className="flex items-center gap-2 text-sm font-normal">
              <Checkbox checked={sendNow} onCheckedChange={(v) => setSendNow(v === true)} />
              Enviar para a produção agora
            </Label>
          )}

          {!order && (
            <>
              {type === 'DELIVERY' && (
                <DeliveryQuoteField
                  state={quoteState}
                  subtotalCents={itemsSubtotal}
                  choice={delivery}
                  onChange={(next) => {
                    setDelivery(next);
                    // Editing the fee or the area clears their errors from the last submit.
                    setErrors(
                      ({
                        deliveryFeeReason: _r,
                        deliveryAreaId: _a,
                        deliveryFeeCents: _f,
                        ...rest
                      }) => rest,
                    );
                  }}
                  canReduce={canDiscount}
                  errors={errors}
                />
              )}
              {canDiscount && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Desconto no pedido" htmlFor={ids.discount}>
                    <DiscountInput
                      id={ids.discount}
                      value={orderDiscount}
                      onChange={setOrderDiscount}
                    />
                  </Field>
                  {orderDiscount.value > 0 && (
                    <Field label="Motivo do desconto" error={errors.orderDiscountReason}>
                      <Input
                        aria-label="Motivo do desconto"
                        value={orderDiscountReason}
                        maxLength={200}
                        onChange={(e) => setOrderDiscountReason(e.target.value)}
                      />
                    </Field>
                  )}
                </div>
              )}
              <Field
                label="Cupom"
                htmlFor={ids.coupon}
                error={errors.couponCode}
                hint={
                  couponCode.trim() && !coupon
                    ? canDiscount
                      ? 'Cupom não encontrado ou inativo'
                      : 'O cupom é validado ao confirmar'
                    : (totals.couponMessage ?? undefined)
                }
              >
                <Input
                  id={ids.coupon}
                  className="uppercase"
                  maxLength={40}
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                />
              </Field>
              {defaultFeeBps > 0 && canDiscount && (
                <div className="space-y-2">
                  <Label className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox checked={waiveFee} onCheckedChange={(v) => setWaiveFee(v === true)} />
                    Retirar taxa de serviço (pedido do cliente)
                  </Label>
                  {waiveFee && (
                    <Input
                      aria-label="Motivo da retirada da taxa"
                      placeholder="Motivo"
                      maxLength={200}
                      aria-invalid={!!errors.serviceFeeWaivedReason}
                      value={waiveReason}
                      onChange={(e) => setWaiveReason(e.target.value)}
                    />
                  )}
                  {errors.serviceFeeWaivedReason && (
                    <p className="text-xs text-destructive">{errors.serviceFeeWaivedReason}</p>
                  )}
                </div>
              )}
              {type !== 'DINE_IN' && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Pagamento">
                    <Select value={payment} onValueChange={(v) => setPayment(v as PaymentMethod)}>
                      <SelectTrigger aria-label="Forma de pagamento" className="w-full">
                        <SelectValue placeholder="Na entrega/retirada" />
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map((m) => (
                          <SelectItem key={m} value={m}>
                            {PAYMENT_METHOD_LABELS[m]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {payment === 'CASH' && (
                    <Field label="Troco para" error={errors.changeForCents}>
                      <MoneyInput
                        aria-label="Troco para"
                        value={changeFor}
                        onChange={setChangeFor}
                      />
                    </Field>
                  )}
                </div>
              )}
              <Field label="Observação do pedido" htmlFor={ids.notes}>
                <Textarea
                  id={ids.notes}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </>
          )}

          <Separator />

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular">{formatBRL(totals.itemsGrossCents)}</dd>
            </div>
            {totals.itemDiscountCents + totals.orderDiscountCents > 0 && (
              <div className="flex justify-between">
                <dt>Descontos</dt>
                <dd className="tabular">
                  − {formatBRL(totals.itemDiscountCents + totals.orderDiscountCents)}
                </dd>
              </div>
            )}
            {totals.couponDiscountCents > 0 && (
              <div className="flex justify-between">
                <dt>Cupom</dt>
                <dd className="tabular">− {formatBRL(totals.couponDiscountCents)}</dd>
              </div>
            )}
            {totals.serviceFeeCents > 0 && (
              <div className="flex justify-between">
                <dt>Taxa de serviço ({totals.serviceFeeBps / 100}%)</dt>
                <dd className="tabular">{formatBRL(totals.serviceFeeCents)}</dd>
              </div>
            )}
            {totals.deliveryFeeCents > 0 && (
              <div className="flex justify-between">
                <dt>Taxa de entrega</dt>
                <dd className="tabular">{formatBRL(totals.deliveryFeeCents)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2 pt-2">
              <dt className="text-base font-bold">{order ? 'Total destes itens' : 'Total'}</dt>
              <dd className="text-kpi font-extrabold">{formatBRL(totals.totalCents)}</dd>
            </div>
          </dl>

          <Button className="w-full" size="xl" loading={busy} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </aside>
      </div>

      {/* Phone: the total stays at the bottom; the summary is below the catalog. */}
      <div className="fixed inset-x-0 bottom-0 z-20 flex items-center gap-3 border-t bg-card p-3 lg:hidden">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {cart.length} {cart.length === 1 ? 'item' : 'itens'}
          </p>
          <p className="text-xl font-extrabold">{formatBRL(totals.totalCents)}</p>
        </div>
        <Button
          size="lg"
          onClick={() => summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          Ver pedido
        </Button>
      </div>

      {index && (
        <ItemBuilderDialog
          index={index}
          target={builder}
          canDiscount={canDiscount}
          onOpenChange={(open) => !open && setBuilder(null)}
          onAdd={(line) => setCart((c) => [...c, { ...line, key: newKey() }])}
        />
      )}
    </Page>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense>
      <Composer />
    </Suspense>
  );
}
