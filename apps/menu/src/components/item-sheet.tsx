'use client';

import {
  type CatalogCategory,
  type CatalogGroup,
  type CatalogIndex,
  type CatalogProduct,
  type OrderItemData,
  describeItem,
  formatBRL,
  optionPriceForSize,
  priceCatalogItem,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@app/ui/components/sheet';
import { Textarea } from '@app/ui/components/textarea';
import { cn } from '@app/ui/lib/utils';
import Image from 'next/image';
import { useId, useState } from 'react';
import type { CartLine } from '@/lib/storage';
import { Field, Stepper } from './common';

export type ItemTarget =
  | { kind: 'product'; product: CatalogProduct; category: CatalogCategory }
  | { kind: 'pizza'; category: CatalogCategory; flavorId?: string };

type Selected = Map<string, { groupId: string; quantity: number }>;

function Choice({
  selected,
  disabled,
  onClick,
  children,
  role = 'checkbox',
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  role?: 'checkbox' | 'radio';
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
        selected ? 'border-primary bg-primary/10' : 'active:bg-accent',
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
  const set = (optionId: string, quantity: number) => {
    const next = new Map(selected);
    if (single) for (const o of group.options) next.delete(o.id);
    if (quantity > 0) next.set(optionId, { groupId: group.groupId, quantity });
    else next.delete(optionId);
    onChange(next);
  };
  const rule =
    group.minSelect > 0
      ? group.minSelect === group.maxSelect
        ? `Escolha ${group.minSelect}`
        : `Escolha de ${group.minSelect} a ${group.maxSelect}`
      : `Opcional · até ${group.maxSelect}`;
  return (
    <fieldset className="space-y-2">
      <legend className="flex w-full items-center justify-between gap-2 font-medium">
        <span>{group.name}</span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-xs font-normal',
            group.minSelect > 0 ? 'bg-primary/10 text-foreground' : 'text-muted-foreground',
          )}
        >
          {rule}
        </span>
      </legend>
      <div className="grid gap-2" role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
        {group.options.map((option) => {
          const quantity = selected.get(option.id)?.quantity ?? 0;
          const price = optionPriceForSize(option, sizeId);
          const full = !single && count >= group.maxSelect && quantity === 0;
          const text = (
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
                className="flex min-h-12 items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-1.5 text-sm"
              >
                {text}
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
            <Choice
              key={option.id}
              role={single ? 'radio' : 'checkbox'}
              selected={quantity > 0}
              disabled={!option.available || full}
              onClick={() => set(option.id, quantity > 0 ? 0 : 1)}
            >
              {text}
              {priceTag}
            </Choice>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Builds one item on the phone: size, pizza flavors, complements, note and quantity. */
export function ItemSheet({
  index,
  target,
  canAdd,
  onClose,
  onAdd,
}: {
  index: CatalogIndex;
  target: ItemTarget | null;
  /** The store is closed or not receiving: the item can be seen, not added. */
  canAdd: boolean;
  onClose: () => void;
  onAdd: (line: Omit<CartLine, 'key'>) => void;
}) {
  const notesId = useId();
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [flavors, setFlavors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Selected>(new Map());
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [showErrors, setShowErrors] = useState(false);

  // Reset for every item opened (state adjusted during render).
  const [current, setCurrent] = useState<ItemTarget | null>(null);
  if (target !== current) {
    setCurrent(target);
    if (target) {
      const sizes =
        target.kind === 'pizza'
          ? target.category.sizes
          : target.product.kind === 'SIZED'
            ? target.product.sizes.filter((s) => s.available && s.priceCents != null)
            : [];
      setSizeId(sizes.length === 1 ? sizes[0]!.id : null);
      setFlavors(target.kind === 'pizza' && target.flavorId ? [target.flavorId] : []);
      setSelected(new Map());
      setQuantity(1);
      setNotes('');
      setShowErrors(false);
    }
  }

  const groups = target
    ? target.kind === 'pizza'
      ? target.category.modifierGroups
      : target.product.modifierGroups
    : [];
  const pizzaSize =
    target?.kind === 'pizza' ? target.category.sizes.find((s) => s.id === sizeId) : undefined;

  const item: OrderItemData | null = target
    ? {
        ...(target.kind === 'pizza'
          ? {
              pizza: {
                categoryId: target.category.id,
                sizeId: sizeId ?? '',
                flavors: flavors.map((productId) => ({ productId, note: null })),
              },
            }
          : { productId: target.product.id, sizeId: sizeId ?? undefined }),
        quantity,
        modifiers: [...selected].map(([optionId, s]) => ({
          groupId: s.groupId,
          optionId,
          quantity: s.quantity,
        })),
        notes: notes.trim() || null,
        discount: null,
        discountReason: null,
      }
    : null;

  // Priced like the API (the server prices it again when the order is placed).
  const result = ((): { error: string } | Omit<CartLine, 'key'> | null => {
    if (!item || !target) return null;
    if (target.kind === 'pizza' && !sizeId) return { error: 'Escolha o tamanho' };
    if (target.kind === 'pizza' && flavors.length === 0) {
      return { error: 'Escolha pelo menos um sabor' };
    }
    try {
      const pricing = priceCatalogItem(index, item);
      return {
        input: item,
        name: pricing.snapshot.name,
        details: describeItem(pricing.snapshot),
        unitChargedPriceCents: pricing.unitChargedPriceCents,
        totalCents: pricing.totalChargedCents,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Item inválido' };
    }
  })();

  function add() {
    if (!result || 'error' in result) return setShowErrors(true);
    onAdd(result);
    onClose();
  }

  const product = target?.kind === 'product' ? target.product : null;
  const image = product?.imageUrl ?? null;
  const title = target
    ? target.kind === 'pizza'
      ? target.category.name
      : target.product.name
    : '';

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0">
        {image && (
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
            <Image
              src={image}
              alt={title}
              fill
              sizes="100vw"
              className="object-cover"
              unoptimized
            />
          </div>
        )}
        <SheetHeader className="p-4 pb-2">
          <SheetTitle className="text-xl">{title}</SheetTitle>
          {product?.description && <SheetDescription>{product.description}</SheetDescription>}
          {target?.kind === 'pizza' && (
            <SheetDescription>Escolha o tamanho e os sabores.</SheetDescription>
          )}
        </SheetHeader>

        {target && (
          <div className="space-y-6 px-4 pb-4">
            {product && product.kind === 'SIZED' && (
              <fieldset className="space-y-2">
                <legend className="font-medium">Tamanho</legend>
                <div className="grid gap-2" role="radiogroup" aria-label="Tamanho">
                  {product.sizes.map((s) => (
                    <Choice
                      key={s.id}
                      role="radio"
                      selected={sizeId === s.id}
                      disabled={!s.available || s.priceCents == null}
                      onClick={() => setSizeId(s.id)}
                    >
                      <span>{s.name}</span>
                      {s.priceCents != null && (
                        <span className="tabular text-sm">
                          {formatBRL(s.promoPriceCents ?? s.priceCents)}
                        </span>
                      )}
                    </Choice>
                  ))}
                </div>
              </fieldset>
            )}

            {target.kind === 'pizza' && (
              <>
                <fieldset className="space-y-2">
                  <legend className="font-medium">Tamanho</legend>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tamanho">
                    {target.category.sizes.map((s) => (
                      <Choice
                        key={s.id}
                        role="radio"
                        selected={sizeId === s.id}
                        onClick={() => {
                          setSizeId(s.id);
                          setFlavors((prev) => prev.slice(0, s.maxFlavors));
                        }}
                      >
                        <span className="flex flex-col">
                          <span>{s.name}</span>
                          <span className="text-xs text-muted-foreground">
                            até {s.maxFlavors} {s.maxFlavors === 1 ? 'sabor' : 'sabores'}
                          </span>
                        </span>
                      </Choice>
                    ))}
                  </div>
                </fieldset>
                {pizzaSize && (
                  <fieldset className="space-y-2">
                    <legend className="flex w-full justify-between font-medium">
                      <span>Sabores</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {flavors.length} de {pizzaSize.maxFlavors}
                      </span>
                    </legend>
                    <div className="grid gap-2" role="group" aria-label="Sabores">
                      {target.category.products.map((p) => {
                        const price = p.sizes.find((s) => s.id === pizzaSize.id);
                        const ok =
                          p.availability.available &&
                          !!price?.available &&
                          price.priceCents != null;
                        const on = flavors.includes(p.id);
                        return (
                          <Choice
                            key={p.id}
                            selected={on}
                            disabled={!ok || (!on && flavors.length >= pizzaSize.maxFlavors)}
                            onClick={() =>
                              setFlavors((prev) =>
                                on ? prev.filter((id) => id !== p.id) : [...prev, p.id],
                              )
                            }
                          >
                            <span className="flex-1">
                              {p.name}
                              {!ok && <span className="text-muted-foreground"> · esgotado</span>}
                              {p.description && (
                                <span className="block text-xs text-muted-foreground">
                                  {p.description}
                                </span>
                              )}
                            </span>
                            {ok && (
                              <span className="tabular text-sm">
                                {formatBRL(price!.promoPriceCents ?? price!.priceCents!)}
                              </span>
                            )}
                          </Choice>
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

            <Field label="Alguma observação?" htmlFor={notesId}>
              <Textarea
                id={notesId}
                value={notes}
                maxLength={280}
                placeholder="Ex.: sem cebola"
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

            {result && 'error' in result && showErrors && (
              <p className="text-sm text-destructive" role="alert">
                {result.error}
              </p>
            )}
          </div>
        )}

        <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background p-4">
          <Stepper label="quantidade" value={quantity} min={1} max={99} onChange={setQuantity} />
          <Button size="lg" className="flex-1" disabled={!canAdd} onClick={add}>
            {canAdd
              ? `Adicionar${result && !('error' in result) ? ` · ${formatBRL(result.totalCents)}` : ''}`
              : 'Pedidos indisponíveis agora'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
