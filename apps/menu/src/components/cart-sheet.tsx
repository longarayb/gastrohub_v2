'use client';

import {
  type AddressInput,
  type CartLineChange,
  type DoorPaymentMethod,
  PAYMENT_METHOD_LABELS,
  type PublicCartPreviewDto,
  type PublicOrderCreatedDto,
  type PublicStoreDto,
  fetchAddressByCEP,
  formatBRL,
  formatCEP,
  formatPhone,
  onlyDigits,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { Checkbox } from '@app/ui/components/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@app/ui/components/sheet';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { ArrowLeft, Bike, ShoppingBag, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { PublicApiError, clientApi } from '@/lib/api';
import { type Cart, useCart, useRecentOrders, useSavedCustomer } from '@/lib/storage';
import { Field, MoneyInput } from './common';

const EMPTY_ADDRESS: AddressInput = {
  cep: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  reference: '',
};

const addressComplete = (a: AddressInput) =>
  onlyDigits(a.cep ?? '').length === 8 &&
  !!a.street.trim() &&
  !!a.number.trim() &&
  !!a.neighborhood.trim() &&
  !!a.city.trim() &&
  (a.state ?? '').trim().length === 2;

function Total({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'text-base font-semibold')}>
      <dt className={cn(!strong && 'text-muted-foreground')}>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

/** Server-side totals of the cart (coupon, delivery area, minimum), refreshed as it changes. */
function usePreview(slug: string, cart: Cart, address: AddressInput, enabled: boolean) {
  const [preview, setPreview] = useState<PublicCartPreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const delivery = cart.type === 'DELIVERY';
  const body =
    enabled && cart.lines.length && (!delivery || addressComplete(address))
      ? JSON.stringify({
          type: cart.type,
          items: cart.lines.map((l) => l.input),
          couponCode: cart.couponCode || null,
          deliveryAddress: delivery ? address : undefined,
        })
      : '';
  useEffect(() => {
    if (!body) {
      setPreview(null);
      return;
    }
    let canceled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      clientApi<PublicCartPreviewDto>(`/public/${slug}/cart`, {
        method: 'POST',
        body: JSON.parse(body),
      })
        .then((p) => !canceled && setPreview(p))
        .catch((error: unknown) => {
          if (!canceled) toast.error(error instanceof Error ? error.message : 'Erro ao calcular');
        })
        .finally(() => !canceled && setLoading(false));
    }, 350);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [body, slug]);
  return { preview, loading, setPreview };
}

export function CartSheet({
  open,
  onOpenChange,
  store,
  canOrder,
  changes,
  onAddMore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  store: PublicStoreDto;
  canOrder: boolean;
  changes: CartLineChange[];
  onAddMore: () => void;
}) {
  const router = useRouter();
  const ids = {
    name: useId(),
    phone: useId(),
    cep: useId(),
    street: useId(),
    number: useId(),
    complement: useId(),
    neighborhood: useId(),
    city: useId(),
    state: useId(),
    reference: useId(),
    change: useId(),
    notes: useId(),
    coupon: useId(),
  };
  const { cart, setCart, clear } = useCart(store.slug);
  const saved = useSavedCustomer();
  const recent = useRecentOrders(store.slug);
  const [step, setStep] = useState<'cart' | 'checkout'>('cart');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState<AddressInput>(EMPTY_ADDRESS);
  const [payment, setPayment] = useState<DoorPaymentMethod | null>(null);
  const [changeFor, setChangeFor] = useState(0);
  const [noChange, setNoChange] = useState(false);
  const [notes, setNotes] = useState('');
  const [coupon, setCoupon] = useState('');
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(0);
  const idempotencyKey = useRef('');

  const type = store.delivers ? cart.type : 'TAKEOUT';
  const effectiveCart = { ...cart, type };
  const { preview, loading, setPreview } = usePreview(
    store.slug,
    effectiveCart,
    address,
    open && step === 'checkout',
  );
  const unavailable = new Set(changes.filter((c) => c.kind === 'UNAVAILABLE').map((c) => c.key));

  // Entering the checkout: saved data of this device, a fresh order key and the fill timer.
  function startCheckout() {
    if (saved.customer) {
      setName(saved.customer.name);
      setPhone(formatPhone(saved.customer.phone));
      if (saved.customer.address) setAddress({ ...EMPTY_ADDRESS, ...saved.customer.address });
    }
    setCoupon(cart.couponCode);
    startedAt.current = Date.now();
    idempotencyKey.current = crypto.randomUUID();
    setErrors({});
    setStep('checkout');
  }

  function forgetMe() {
    saved.clear();
    recent.clear();
    setName('');
    setPhone('');
    setAddress(EMPTY_ADDRESS);
    toast.success('Seus dados foram apagados deste aparelho');
  }

  async function lookupCep(cep: string) {
    const digits = onlyDigits(cep);
    setAddress((a) => ({ ...a, cep: formatCEP(digits) }));
    if (digits.length !== 8) return;
    try {
      const found = await fetchAddressByCEP(digits);
      if (!found) return setErrors((e) => ({ ...e, 'deliveryAddress.cep': 'CEP não encontrado' }));
      setAddress((a) => ({
        ...a,
        street: found.street || a.street,
        neighborhood: found.neighborhood || a.neighborhood,
        city: found.city || a.city,
        state: found.state || a.state,
      }));
      setErrors(({ 'deliveryAddress.cep': _drop, ...rest }) => rest);
    } catch {
      // Offline or ViaCEP down: the customer types the address.
    }
  }

  function setLines(lines: Cart['lines']) {
    setCart({ ...cart, lines });
    if (!lines.length) {
      setStep('cart');
      onOpenChange(false);
    }
  }

  async function submit() {
    const found: Record<string, string> = {};
    if (name.trim().length < 2) found['customer.name'] = 'Informe seu nome';
    if (onlyDigits(phone).length !== 11) found['customer.phone'] = 'Informe um celular com DDD';
    if (type === 'DELIVERY' && !addressComplete(address))
      found.deliveryAddress = 'Complete o endereço';
    if (!payment) found.expectedPaymentMethod = 'Escolha como vai pagar';
    if (
      payment === 'CASH' &&
      !noChange &&
      preview &&
      changeFor > 0 &&
      changeFor < preview.totalCents
    ) {
      found.changeForCents = 'O valor para troco é menor que o total';
    }
    if (!privacy) found.acceptPrivacy = 'Aceite o aviso de privacidade para continuar';
    setErrors(found);
    if (Object.keys(found).length || !preview) return;
    setBusy(true);
    try {
      const created = await clientApi<PublicOrderCreatedDto>(`/public/${store.slug}/orders`, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey.current },
        body: {
          type,
          items: cart.lines.map((l) => l.input),
          couponCode: preview.coupon?.applied ? preview.coupon.code : null,
          deliveryAddress: type === 'DELIVERY' ? address : undefined,
          customer: { name: name.trim(), phone },
          expectedPaymentMethod: payment,
          changeForCents: payment === 'CASH' && !noChange && changeFor > 0 ? changeFor : null,
          notes: notes.trim() || null,
          acceptPrivacy: true,
          marketingOptIn: marketing,
          expectedTotalCents: preview.totalCents,
          website: (document.getElementById('website') as HTMLInputElement | null)?.value ?? '',
          formStartedAt: startedAt.current,
        },
      });
      saved.save({
        name: name.trim(),
        phone: onlyDigits(phone),
        address: type === 'DELIVERY' ? address : (saved.customer?.address ?? null),
      });
      recent.add({
        slug: store.slug,
        number: created.number,
        token: created.trackingToken,
        at: new Date().toISOString(),
      });
      clear();
      router.push(`/${store.slug}/pedido/${created.trackingToken}`);
    } catch (error) {
      if (error instanceof PublicApiError && error.status === 409 && error.body.details) {
        setPreview(error.body.details as PublicCartPreviewDto);
        idempotencyKey.current = crypto.randomUUID();
        toast.error('Os valores mudaram. Confira o resumo e envie de novo.');
      } else if (error instanceof PublicApiError && Object.keys(error.fieldErrors).length) {
        setErrors(error.fieldErrors);
        toast.error(error.message);
      } else {
        toast.error(error instanceof Error ? error.message : 'Não foi possível enviar o pedido');
      }
    } finally {
      setBusy(false);
    }
  }

  const delivery = preview?.delivery;
  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setStep('cart');
      }}
    >
      <SheetContent side="bottom" className="max-h-[94dvh] gap-0 overflow-y-auto rounded-t-2xl p-0">
        <SheetHeader className="flex-row items-center gap-2 border-b p-4">
          {step === 'checkout' && (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Voltar ao carrinho"
              onClick={() => setStep('cart')}
            >
              <ArrowLeft />
            </Button>
          )}
          <div>
            <SheetTitle>{step === 'cart' ? 'Seu carrinho' : 'Finalizar pedido'}</SheetTitle>
            <SheetDescription>{store.name}</SheetDescription>
          </div>
        </SheetHeader>

        {step === 'cart' ? (
          <div className="space-y-4 p-4">
            <ul className="divide-y" aria-label="Itens do carrinho">
              {cart.lines.map((line) => {
                const change = changes.find((c) => c.key === line.key);
                return (
                  <li key={line.key} className="flex gap-3 py-3">
                    <span className="tabular w-6 font-medium">{line.input.quantity}×</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{line.name}</span>
                      {line.details && (
                        <span className="block text-sm text-muted-foreground">{line.details}</span>
                      )}
                      {change && (
                        <span className="block text-sm text-destructive">
                          {change.kind === 'UNAVAILABLE'
                            ? `Indisponível: ${change.message}`
                            : `Preço mudou para ${formatBRL(change.toCents)}`}
                        </span>
                      )}
                    </span>
                    <span className="tabular">{formatBRL(line.totalCents)}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remover ${line.name}`}
                      onClick={() => setLines(cart.lines.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Button variant="outline" className="w-full" onClick={onAddMore}>
              Adicionar mais itens
            </Button>
            {changes.some((c) => c.kind === 'PRICE_CHANGED') && (
              <p className="text-sm text-muted-foreground">
                Alguns preços mudaram desde que você adicionou os itens. Remova e adicione de novo
                para ver o valor atualizado.
              </p>
            )}
            <Button
              size="lg"
              className="w-full"
              disabled={!canOrder || unavailable.size > 0}
              onClick={startCheckout}
            >
              {!canOrder
                ? 'Pedidos indisponíveis agora'
                : unavailable.size
                  ? 'Remova os itens indisponíveis'
                  : 'Continuar'}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-6 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {/* Honeypot: invisible to people, bots fill it. */}
            <input
              id="website"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
            />

            {store.delivers && (
              <div role="radiogroup" aria-label="Como receber" className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['DELIVERY', 'Entrega', Bike],
                    ['TAKEOUT', 'Retirar no local', ShoppingBag],
                  ] as const
                ).map(([value, label, Icon]) => (
                  <Button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={type === value}
                    variant={type === value ? 'default' : 'outline'}
                    className="h-12"
                    onClick={() => setCart({ ...cart, type: value })}
                  >
                    <Icon /> {label}
                  </Button>
                ))}
              </div>
            )}

            <section className="space-y-3" aria-label="Seus dados">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">Seus dados</h3>
                {saved.customer && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={forgetMe}
                  >
                    Não é você? Limpar meus dados
                  </button>
                )}
              </div>
              <Field label="Nome" htmlFor={ids.name} error={errors['customer.name']}>
                <Input
                  id={ids.name}
                  autoComplete="name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="Celular com DDD" htmlFor={ids.phone} error={errors['customer.phone']}>
                <Input
                  id={ids.phone}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="(11) 99999-9999"
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                />
              </Field>
            </section>

            {type === 'DELIVERY' ? (
              <section className="space-y-3" aria-label="Endereço de entrega">
                <h3 className="font-medium">Endereço de entrega</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="CEP" htmlFor={ids.cep} error={errors['deliveryAddress.cep']}>
                    <Input
                      id={ids.cep}
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={address.cep ?? ''}
                      onChange={(e) => void lookupCep(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Número"
                    htmlFor={ids.number}
                    error={errors['deliveryAddress.number']}
                  >
                    <Input
                      id={ids.number}
                      value={address.number}
                      onChange={(e) => setAddress({ ...address, number: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Rua" htmlFor={ids.street}>
                  <Input
                    id={ids.street}
                    autoComplete="address-line1"
                    value={address.street}
                    onChange={(e) => setAddress({ ...address, street: e.target.value })}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Complemento" htmlFor={ids.complement}>
                    <Input
                      id={ids.complement}
                      value={address.complement ?? ''}
                      onChange={(e) => setAddress({ ...address, complement: e.target.value })}
                    />
                  </Field>
                  <Field label="Bairro" htmlFor={ids.neighborhood}>
                    <Input
                      id={ids.neighborhood}
                      value={address.neighborhood}
                      onChange={(e) => setAddress({ ...address, neighborhood: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-[1fr_5rem] gap-3">
                  <Field label="Cidade" htmlFor={ids.city}>
                    <Input
                      id={ids.city}
                      value={address.city}
                      onChange={(e) => setAddress({ ...address, city: e.target.value })}
                    />
                  </Field>
                  <Field label="UF" htmlFor={ids.state}>
                    <Input
                      id={ids.state}
                      maxLength={2}
                      className="uppercase"
                      value={address.state ?? ''}
                      onChange={(e) =>
                        setAddress({ ...address, state: e.target.value.toUpperCase() })
                      }
                    />
                  </Field>
                </div>
                <Field label="Ponto de referência" htmlFor={ids.reference}>
                  <Input
                    id={ids.reference}
                    value={address.reference ?? ''}
                    onChange={(e) => setAddress({ ...address, reference: e.target.value })}
                  />
                </Field>
                {errors.deliveryAddress && (
                  <p className="text-sm text-destructive">{errors.deliveryAddress}</p>
                )}
              </section>
            ) : (
              store.address && (
                <p className="rounded-lg bg-muted p-3 text-sm">
                  Retire em {store.address.street}, {store.address.number} ·{' '}
                  {store.address.neighborhood}
                  {preview ? ` · pronto em cerca de ${preview.takeoutEtaMinutes} min` : ''}
                </p>
              )
            )}

            <section className="space-y-3" aria-label="Pagamento">
              <h3 className="font-medium">
                Pagamento {type === 'DELIVERY' ? 'na entrega' : 'na retirada'}
              </h3>
              <div
                role="radiogroup"
                aria-label="Forma de pagamento"
                className="grid grid-cols-2 gap-2"
              >
                {store.paymentMethods.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={payment === m}
                    variant={payment === m ? 'default' : 'outline'}
                    className="h-12"
                    onClick={() => setPayment(m)}
                  >
                    {PAYMENT_METHOD_LABELS[m]}
                  </Button>
                ))}
              </div>
              {errors.expectedPaymentMethod && (
                <p className="text-sm text-destructive">{errors.expectedPaymentMethod}</p>
              )}
              {payment === 'CASH' && (
                <div className="space-y-2">
                  {!noChange && (
                    <Field
                      label="Troco para quanto?"
                      htmlFor={ids.change}
                      error={errors.changeForCents}
                    >
                      <MoneyInput id={ids.change} value={changeFor} onChange={setChangeFor} />
                    </Field>
                  )}
                  <Label className="flex items-center gap-2 text-sm font-normal">
                    <Checkbox checked={noChange} onCheckedChange={(v) => setNoChange(v === true)} />
                    Não preciso de troco
                  </Label>
                </div>
              )}
              {payment === 'PIX' && (
                <p className="text-sm text-muted-foreground">
                  O QR Code do PIX aparece na página do pedido depois que o restaurante aceitar.
                </p>
              )}
            </section>

            <section className="grid grid-cols-[1fr_auto] items-end gap-2" aria-label="Cupom">
              <Field label="Cupom" htmlFor={ids.coupon}>
                <Input
                  id={ids.coupon}
                  className="uppercase"
                  maxLength={40}
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value)}
                />
              </Field>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCart({ ...cart, couponCode: coupon.trim().toUpperCase() })}
              >
                Aplicar
              </Button>
              {preview?.coupon && (
                <p
                  className={cn(
                    'col-span-2 text-sm',
                    preview.coupon.applied ? 'text-success' : 'text-destructive',
                  )}
                >
                  {preview.coupon.applied
                    ? `Cupom ${preview.coupon.code} aplicado`
                    : preview.coupon.message}
                </p>
              )}
            </section>

            <Field label="Observação para o restaurante" htmlFor={ids.notes}>
              <Textarea
                id={ids.notes}
                value={notes}
                maxLength={300}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            <section className="space-y-2 rounded-lg border p-3 text-sm" aria-label="Resumo">
              {!preview ? (
                <p className="text-muted-foreground">
                  {type === 'DELIVERY' && !addressComplete(address)
                    ? 'Complete o endereço para calcular a entrega.'
                    : loading
                      ? 'Calculando...'
                      : 'Resumo do pedido'}
                </p>
              ) : (
                <dl className="space-y-1">
                  <Total label="Produtos" value={formatBRL(preview.subtotalCents)} />
                  {preview.couponDiscountCents > 0 && (
                    <Total label="Cupom" value={`− ${formatBRL(preview.couponDiscountCents)}`} />
                  )}
                  {type === 'DELIVERY' && delivery?.ok && (
                    <Total
                      label={`Entrega${delivery.areaName ? ` · ${delivery.areaName}` : ''}`}
                      value={
                        preview.deliveryFeeCents ? formatBRL(preview.deliveryFeeCents) : 'Grátis'
                      }
                    />
                  )}
                  <Total label="Total" value={formatBRL(preview.totalCents)} strong />
                  {type === 'DELIVERY' && delivery?.ok && delivery.etaMinutes != null && (
                    <p className="text-muted-foreground">
                      Entrega em cerca de {delivery.etaMinutes} min
                    </p>
                  )}
                  {delivery?.missingForFreeCents ? (
                    <p className="text-muted-foreground">
                      Faltam {formatBRL(delivery.missingForFreeCents)} para a entrega grátis
                    </p>
                  ) : null}
                </dl>
              )}
              {preview?.blockingMessage && (
                <p className="font-medium text-destructive" role="alert">
                  {preview.blockingMessage}
                </p>
              )}
            </section>

            <section className="space-y-2 text-sm" aria-label="Privacidade">
              <Label className="flex items-start gap-2 font-normal">
                <Checkbox
                  className="mt-0.5"
                  checked={privacy}
                  onCheckedChange={(v) => setPrivacy(v === true)}
                />
                <span>
                  Li e aceito o{' '}
                  <button type="button" className="underline" onClick={() => setNoticeOpen(true)}>
                    aviso de privacidade
                  </button>{' '}
                  do {store.name}.
                </span>
              </Label>
              {errors.acceptPrivacy && <p className="text-destructive">{errors.acceptPrivacy}</p>}
              <Label className="flex items-start gap-2 font-normal text-muted-foreground">
                <Checkbox
                  className="mt-0.5"
                  checked={marketing}
                  onCheckedChange={(v) => setMarketing(v === true)}
                />
                Quero receber novidades e promoções do {store.name} (opcional)
              </Label>
            </section>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={busy}
              disabled={!preview?.canOrder}
            >
              Enviar pedido{preview ? ` · ${formatBRL(preview.totalCents)}` : ''}
            </Button>
          </form>
        )}
        <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Aviso de privacidade</DialogTitle>
              <DialogDescription>{store.name}</DialogDescription>
            </DialogHeader>
            <p className="text-sm whitespace-pre-line">{store.privacyNotice}</p>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
