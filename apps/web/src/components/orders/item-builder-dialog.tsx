'use client';

import {
  type CatalogCategory,
  type CatalogGroup,
  type CatalogIndex,
  type CatalogProduct,
  type DiscountData,
  type MenuItemPricing,
  type OrderItemData,
  type OrderItemInput,
  formatBRL,
  optionPriceForSize,
  orderItemInputSchema,
  priceCatalogItem,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@app/ui/components/dialog';
import { Input } from '@app/ui/components/input';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Field } from '@/components/form';
import { DiscountInput } from './order-discount-dialog';

export type BuilderTarget =
  | { kind: 'product'; product: CatalogProduct; category: CatalogCategory }
  | { kind: 'pizza'; category: CatalogCategory };

export interface CartLine {
  key: string;
  input: OrderItemData;
  pricing: MenuItemPricing;
}

type Selected = Map<string, { groupId: string; quantity: number }>;

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Diminuir"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus />
      </Button>
      <span className="tabular w-6 text-center text-sm font-medium">{value}</span>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Aumentar"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus />
      </Button>
    </div>
  );
}

function OptionButton({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
        selected ? 'border-primary bg-primary/10' : 'hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function GroupPicker({
  group,
  sizeId,
  selected,
  onChange,
}: {
  group: CatalogGroup;
  sizeId: string | null;
  selected: Selected;
  onChange: (next: Selected) => void;
}) {
  const count = group.options.reduce((sum, o) => sum + (selected.get(o.id)?.quantity ?? 0), 0);
  const single = group.maxSelect === 1;

  function set(optionId: string, quantity: number) {
    const next = new Map(selected);
    if (single) {
      for (const o of group.options) next.delete(o.id);
    }
    if (quantity > 0) next.set(optionId, { groupId: group.groupId, quantity });
    else next.delete(optionId);
    onChange(next);
  }

  const rule =
    group.minSelect > 0
      ? group.minSelect === group.maxSelect
        ? `Escolha ${group.minSelect}`
        : `Obrigatório · ${group.minSelect} a ${group.maxSelect}`
      : `Opcional · até ${group.maxSelect}`;

  return (
    <fieldset className="space-y-2">
      <legend className="flex w-full items-center justify-between gap-2 text-sm font-medium">
        <span>{group.name}</span>
        <span className="text-xs font-normal text-muted-foreground">{rule}</span>
      </legend>
      <div className="grid gap-1.5">
        {group.options.map((option) => {
          const quantity = selected.get(option.id)?.quantity ?? 0;
          const price = optionPriceForSize(option, sizeId);
          const full = !single && count >= group.maxSelect && quantity === 0;
          const label = (
            <span className="flex-1">
              {option.name}
              {!option.available && <span className="text-muted-foreground"> · esgotado</span>}
            </span>
          );
          const priceTag = price > 0 && (
            <span className="tabular text-xs text-muted-foreground">+ {formatBRL(price)}</span>
          );
          if (option.maxQuantity > 1 && quantity > 0) {
            return (
              <div
                key={option.id}
                className="flex items-center gap-2 rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm"
              >
                {label}
                {priceTag}
                <Stepper
                  label={option.name}
                  value={quantity}
                  min={0}
                  max={Math.min(option.maxQuantity, quantity + group.maxSelect - count)}
                  onChange={(q) => set(option.id, q)}
                />
              </div>
            );
          }
          return (
            <OptionButton
              key={option.id}
              selected={quantity > 0}
              disabled={!option.available || full}
              onClick={() => set(option.id, quantity > 0 ? 0 : 1)}
            >
              {label}
              {priceTag}
            </OptionButton>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Builds one order item: size, pizza flavors, complements, quantity, notes and discount. */
export function ItemBuilderDialog({
  index,
  target,
  canDiscount,
  onOpenChange,
  onAdd,
}: {
  index: CatalogIndex;
  target: BuilderTarget | null;
  canDiscount: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const notesId = useId();
  const discountId = useId();
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [flavors, setFlavors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Selected>(new Map());
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [discount, setDiscount] = useState<DiscountData>({ type: 'VALUE', value: 0 });
  const [discountReason, setDiscountReason] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!target) return;
    const sizes =
      target.kind === 'pizza'
        ? target.category.sizes
        : target.product.kind === 'SIZED'
          ? target.product.sizes.filter((s) => s.available)
          : [];
    setSizeId(sizes.length === 1 ? sizes[0]!.id : null);
    setFlavors([]);
    setSelected(new Map());
    setQuantity(1);
    setNotes('');
    setDiscount({ type: 'VALUE', value: 0 });
    setDiscountReason('');
    setShowErrors(false);
  }, [target]);

  const groups = target
    ? target.kind === 'pizza'
      ? target.category.modifierGroups
      : target.product.modifierGroups
    : [];
  const pizzaSize =
    target?.kind === 'pizza' ? target.category.sizes.find((s) => s.id === sizeId) : undefined;

  const raw: OrderItemInput | null = target
    ? {
        ...(target.kind === 'pizza'
          ? {
              pizza: {
                categoryId: target.category.id,
                sizeId: sizeId ?? '',
                flavors: flavors.map((productId) => ({ productId })),
              },
            }
          : { productId: target.product.id, sizeId: sizeId ?? undefined }),
        quantity,
        modifiers: [...selected].map(([optionId, s]) => ({
          groupId: s.groupId,
          optionId,
          quantity: s.quantity,
        })),
        notes,
        discount: discount.value > 0 ? discount : null,
        discountReason,
      }
    : null;

  // Priced on every render: cheap, and always in sync with the API rules.
  const result = ((): { error: string } | Omit<CartLine, 'key'> | null => {
    if (!raw) return null;
    const parsed = orderItemInputSchema.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Item inválido' };
    try {
      return { input: parsed.data, pricing: priceCatalogItem(index, parsed.data) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Item inválido' };
    }
  })();

  const discountError =
    discount.value > 0 && discountReason.trim().length < 3 ? 'Informe o motivo do desconto' : null;

  function add() {
    if (!result || 'error' in result || discountError) return setShowErrors(true);
    onAdd({ input: result.input, pricing: result.pricing });
    onOpenChange(false);
  }

  const title = target
    ? target.kind === 'pizza'
      ? target.category.name
      : target.product.name
    : '';
  const gross = result && !('error' in result) ? result.pricing.totalChargedCents : null;

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {target?.kind === 'product' && target.product.description && (
            <DialogDescription>{target.product.description}</DialogDescription>
          )}
          {target?.kind === 'pizza' && (
            <DialogDescription>Escolha o tamanho e os sabores.</DialogDescription>
          )}
        </DialogHeader>

        {target && (
          <div className="space-y-5">
            {/* Sizes */}
            {target.kind === 'product' && target.product.kind === 'SIZED' && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Tamanho</legend>
                <div className="grid gap-1.5">
                  {target.product.sizes.map((s) => (
                    <OptionButton
                      key={s.id}
                      selected={sizeId === s.id}
                      disabled={!s.available || s.priceCents == null}
                      onClick={() => setSizeId(s.id)}
                    >
                      <span>{s.name}</span>
                      {s.priceCents != null && (
                        <span className="tabular text-xs text-muted-foreground">
                          {formatBRL(s.promoPriceCents ?? s.priceCents)}
                        </span>
                      )}
                    </OptionButton>
                  ))}
                </div>
              </fieldset>
            )}
            {target.kind === 'pizza' && (
              <>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Tamanho</legend>
                  <div className="grid grid-cols-2 gap-1.5">
                    {target.category.sizes.map((s) => (
                      <OptionButton
                        key={s.id}
                        selected={sizeId === s.id}
                        onClick={() => {
                          setSizeId(s.id);
                          setFlavors((prev) => prev.slice(0, s.maxFlavors));
                        }}
                      >
                        <span>{s.name}</span>
                        <span className="text-xs text-muted-foreground">
                          até {s.maxFlavors} {s.maxFlavors === 1 ? 'sabor' : 'sabores'}
                        </span>
                      </OptionButton>
                    ))}
                  </div>
                </fieldset>
                {pizzaSize && (
                  <fieldset className="space-y-2">
                    <legend className="flex w-full justify-between text-sm font-medium">
                      <span>Sabores</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {flavors.length}/{pizzaSize.maxFlavors}
                      </span>
                    </legend>
                    <div className="grid gap-1.5">
                      {target.category.products.map((p) => {
                        const price = p.sizes.find((s) => s.id === pizzaSize.id);
                        const ok =
                          p.availability.available &&
                          !!price?.available &&
                          price.priceCents != null;
                        const on = flavors.includes(p.id);
                        return (
                          <OptionButton
                            key={p.id}
                            selected={on}
                            disabled={!ok || (!on && flavors.length >= pizzaSize.maxFlavors)}
                            onClick={() =>
                              setFlavors((prev) =>
                                on ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                              )
                            }
                          >
                            <span>
                              {p.name}
                              {!ok && (
                                <span className="text-muted-foreground"> · indisponível</span>
                              )}
                            </span>
                            {ok && (
                              <span className="tabular text-xs text-muted-foreground">
                                {formatBRL(price!.promoPriceCents ?? price!.priceCents!)}
                              </span>
                            )}
                          </OptionButton>
                        );
                      })}
                    </div>
                  </fieldset>
                )}
              </>
            )}

            {groups.map((g) => (
              <GroupPicker
                key={g.groupId}
                group={g}
                sizeId={sizeId}
                selected={selected}
                onChange={setSelected}
              />
            ))}

            <Field label="Observação" htmlFor={notesId}>
              <Textarea
                id={notesId}
                value={notes}
                maxLength={280}
                placeholder="Ex.: sem cebola"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            {canDiscount && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Desconto no item" htmlFor={discountId}>
                  <DiscountInput id={discountId} value={discount} onChange={setDiscount} />
                </Field>
                {discount.value > 0 && (
                  <Field
                    label="Motivo do desconto"
                    error={showErrors ? (discountError ?? undefined) : undefined}
                  >
                    <Input
                      value={discountReason}
                      maxLength={200}
                      aria-label="Motivo do desconto"
                      onChange={(e) => setDiscountReason(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}

            {result && 'error' in result && (
              <p
                className={cn('text-sm', showErrors ? 'text-destructive' : 'text-muted-foreground')}
                role={showErrors ? 'alert' : undefined}
              >
                {result.error}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <Stepper label="Quantidade" value={quantity} min={1} max={99} onChange={setQuantity} />
          <Button onClick={add}>Adicionar{gross != null ? ` · ${formatBRL(gross)}` : ''}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
