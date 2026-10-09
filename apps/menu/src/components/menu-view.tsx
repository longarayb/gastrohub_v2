'use client';

import {
  type CatalogDto,
  type CatalogProduct,
  type PublicStoreDto,
  cartChanges,
  formatBRL,
  formatPhone,
  indexCatalog,
  storeOpenState,
} from '@app/shared';
import { Button } from '@app/ui/components/button';
import { cn } from '@app/ui/lib/utils';
import { Bike, Clock, MapPin, Phone, ShoppingBag, Store } from 'lucide-react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { type CartLine, useCart, useRecentOrders } from '@/lib/storage';
import { useNow } from './common';
import type { ItemTarget } from './item-sheet';

// The sheets (and their dialog code) load on the first tap, not with the page: lighter on 3G.
const ItemSheet = dynamic(() => import('./item-sheet').then((m) => m.ItemSheet), { ssr: false });
const CartSheet = dynamic(() => import('./cart-sheet').then((m) => m.CartSheet), { ssr: false });

function priceLabel(p: CatalogProduct): { text: string; was: string | null } {
  const { fromCents, toCents, hasPromo } = p.price;
  if (fromCents == null) return { text: '', was: null };
  const text =
    toCents != null && toCents !== fromCents
      ? `a partir de ${formatBRL(fromCents)}`
      : formatBRL(fromCents);
  const was =
    hasPromo && p.priceCents != null && p.promoPriceCents != null ? formatBRL(p.priceCents) : null;
  return { text, was };
}

function ProductRow({ product, onOpen }: { product: CatalogProduct; onOpen: () => void }) {
  const price = priceLabel(product);
  const available = product.availability.available;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={product.name}
        // Unavailable: only the photo fades; dimmed text would fail 4.5:1 (axe).
        className="flex w-full gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block font-medium">{product.name}</span>
          {product.description && (
            <span className="line-clamp-2 block text-sm text-muted-foreground">
              {product.description}
            </span>
          )}
          <span className="flex flex-wrap items-baseline gap-2 text-sm">
            {available ? (
              <>
                <span className="tabular font-semibold">{price.text}</span>
                {price.was && (
                  <span className="tabular text-xs text-muted-foreground line-through">
                    {price.was}
                  </span>
                )}
              </>
            ) : (
              <span className="font-medium text-muted-foreground">
                {product.availability.reasons[0]?.message ?? 'Esgotado hoje'}
              </span>
            )}
          </span>
        </span>
        {product.thumbUrl && (
          <span
            className={cn(
              'relative size-24 shrink-0 overflow-hidden rounded-lg bg-muted',
              !available && 'opacity-50 grayscale',
            )}
          >
            <Image
              src={product.thumbUrl}
              alt=""
              fill
              sizes="96px"
              loading="lazy"
              className="object-cover"
              unoptimized
            />
          </span>
        )}
      </button>
    </li>
  );
}

/** The digital menu of one restaurant (server-rendered, interactive on the phone). */
export function MenuView({ store, catalog }: { store: PublicStoreDto; catalog: CatalogDto }) {
  const index = useMemo(() => indexCatalog(catalog), [catalog]);
  const now = useNow();
  const open = now ? storeOpenState(store.hours, now, store.timezone) : store.openState;
  const canOrder = store.accepting && open.open;
  const { cart, setCart } = useCart(store.slug);
  const recent = useRecentOrders(store.slug);
  const [target, setTarget] = useState<ItemTarget | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  // Mounted after the first use only (their code is downloaded then).
  const [itemUsed, setItemUsed] = useState(false);
  const [cartUsed, setCartUsed] = useState(false);
  if (target && !itemUsed) setItemUsed(true);
  if (cartOpen && !cartUsed) setCartUsed(true);

  const categories = catalog.categories.filter((c) => c.products.length > 0);
  // Items of a cart saved earlier that ran out or changed price.
  const changes = useMemo(() => cartChanges(cart.lines, index), [cart.lines, index]);
  const count = cart.lines.reduce((t, l) => t + l.input.quantity, 0);
  const total = cart.lines.reduce((t, l) => t + l.totalCents, 0);

  function addLine(line: Omit<CartLine, 'key'>) {
    setCart({
      ...cart,
      lines: [...cart.lines, { ...line, key: crypto.randomUUID() }],
    });
  }

  return (
    <main className="mx-auto max-w-2xl">
      <header>
        <div className="relative h-36 w-full overflow-hidden bg-primary sm:h-48">
          {store.coverUrl && (
            <Image
              src={store.coverUrl}
              alt=""
              fill
              priority
              sizes="(max-width: 672px) 100vw, 672px"
              className="object-cover"
              unoptimized
            />
          )}
        </div>
        <div className="-mt-10 flex items-end gap-3 px-4">
          <span className="relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 border-background bg-card shadow-sm">
            {store.logoUrl ? (
              <Image
                src={store.logoUrl}
                alt={`Logo ${store.name}`}
                fill
                sizes="80px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <Store className="size-8 text-muted-foreground" aria-hidden />
            )}
          </span>
          <h1 className="pb-1 text-2xl leading-tight font-bold">{store.name}</h1>
        </div>
        <div className="space-y-2 px-4 pt-3">
          {store.description && <p className="text-muted-foreground">{store.description}</p>}
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span
              className={cn(
                'inline-flex items-center gap-1 font-medium',
                open.open ? 'text-success' : 'text-destructive',
              )}
              role="status"
            >
              <Clock className="size-4" aria-hidden />
              {open.open
                ? 'Aberto agora'
                : `Fechado${open.nextOpening ? ` · abre ${open.nextOpening.label}` : ''}`}
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              {store.delivers ? (
                <Bike className="size-4" aria-hidden />
              ) : (
                <ShoppingBag className="size-4" aria-hidden />
              )}
              {store.delivers ? 'Entrega e retirada' : 'Retirada no local'}
            </span>
            {store.phone && (
              <a
                href={`tel:+55${store.phone}`}
                className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
              >
                <Phone className="size-4" aria-hidden />
                {formatPhone(store.phone)}
              </a>
            )}
          </p>
          {store.address && (
            <p className="flex items-start gap-1 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
              {store.address.street}, {store.address.number} · {store.address.neighborhood} ·{' '}
              {store.address.city}
            </p>
          )}
          {!store.accepting && (
            <p className="rounded-lg bg-muted p-3 text-sm font-medium">
              O restaurante não está recebendo pedidos pelo cardápio agora. Você pode ver o cardápio
              {store.phone ? ` ou ligar para ${formatPhone(store.phone)}` : ''}.
            </p>
          )}
          {store.accepting && !open.open && (
            <p className="rounded-lg bg-muted p-3 text-sm font-medium">
              Fechado agora{open.nextOpening ? `. Abrimos ${open.nextOpening.label}` : ''}. Veja o
              cardápio e volte para pedir.
            </p>
          )}
          {recent.orders[0] && (
            <Link
              href={`/${store.slug}/pedido/${recent.orders[0].token}`}
              className="block rounded-lg border p-3 text-sm font-medium underline-offset-4 hover:underline"
            >
              Acompanhar o pedido #{recent.orders[0].number}
            </Link>
          )}
        </div>
      </header>

      <nav
        aria-label="Categorias"
        className="sticky top-0 z-10 mt-4 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur"
      >
        {categories.map((c) => (
          <a
            key={c.id}
            href={`#cat-${c.id}`}
            className="shrink-0 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap active:bg-accent"
          >
            {c.name}
          </a>
        ))}
      </nav>

      <div className="px-4">
        {categories.map((category) => (
          <section
            key={category.id}
            id={`cat-${category.id}`}
            aria-label={category.name}
            className="scroll-mt-14 pt-6"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{category.name}</h2>
              {category.kind === 'PIZZA' && (
                <Button size="sm" onClick={() => setTarget({ kind: 'pizza', category })}>
                  Montar pizza
                </Button>
              )}
            </div>
            {category.description && (
              <p className="text-sm text-muted-foreground">{category.description}</p>
            )}
            <ul className="divide-y">
              {category.products.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  onOpen={() =>
                    setTarget(
                      category.kind === 'PIZZA'
                        ? { kind: 'pizza', category, flavorId: product.id }
                        : { kind: 'product', product, category },
                    )
                  }
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 backdrop-blur">
          <Button
            size="lg"
            className="mx-auto flex w-full max-w-2xl justify-between"
            onClick={() => setCartOpen(true)}
          >
            <span>
              Ver carrinho · {count} {count === 1 ? 'item' : 'itens'}
              {changes.length > 0 && ' · revise'}
            </span>
            <span className="tabular">{formatBRL(total)}</span>
          </Button>
        </div>
      )}

      {itemUsed && (
        <ItemSheet
          index={index}
          target={target}
          canAdd={canOrder}
          onClose={() => setTarget(null)}
          onAdd={addLine}
        />
      )}
      {cartUsed && (
        <CartSheet
          open={cartOpen}
          onOpenChange={setCartOpen}
          store={store}
          canOrder={canOrder}
          changes={changes}
          onAddMore={() => setCartOpen(false)}
        />
      )}
    </main>
  );
}
