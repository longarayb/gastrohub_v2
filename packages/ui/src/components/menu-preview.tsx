import type { CatalogCategory, CatalogGroup, CatalogProduct, PriceRange } from '@app/shared';
import { formatBRL, optionPriceForSize } from '@app/shared';
import { ImageOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from './badge';

/**
 * Customer-facing product presentation. Used by the admin preview and, later,
 * by the digital menu (which adds interactivity on top).
 */

export function PriceLabel({ price, className }: { price: PriceRange; className?: string }) {
  if (price.fromCents == null) return null;
  const range = price.toCents != null && price.toCents !== price.fromCents;
  return (
    <span className={cn('tabular font-semibold', price.hasPromo && 'text-success', className)}>
      {range ? `a partir de ${formatBRL(price.fromCents)}` : formatBRL(price.fromCents)}
    </span>
  );
}

function FullPrice({ product }: { product: CatalogProduct }) {
  if (product.priceCents == null || product.promoPriceCents == null) return null;
  if (product.promoPriceCents >= product.priceCents) return null;
  return (
    <span className="tabular text-xs text-muted-foreground line-through">
      {formatBRL(product.priceCents)}
    </span>
  );
}

export function MenuProductCard({
  product,
  onClick,
  className,
}: {
  product: CatalogProduct;
  onClick?: () => void;
  className?: string;
}) {
  const unavailable = !product.availability.available;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40',
        unavailable && 'opacity-60',
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{product.name}</p>
        {product.description && (
          <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {unavailable ? (
            <Badge variant="outline">Indisponível</Badge>
          ) : (
            <>
              <PriceLabel price={product.price} />
              <FullPrice product={product} />
            </>
          )}
        </div>
      </div>
      {product.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.thumbUrl}
          alt=""
          className="size-20 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      ) : null}
    </button>
  );
}

function GroupRules({ group }: { group: CatalogGroup }) {
  const required = group.minSelect > 0;
  const text =
    group.maxSelect === 1
      ? 'Escolha 1 opção'
      : required
        ? `Escolha de ${group.minSelect} a ${group.maxSelect}`
        : `Escolha até ${group.maxSelect}`;
  return (
    <div className="flex items-center justify-between gap-2 bg-muted/60 px-4 py-2">
      <div>
        <p className="text-sm font-semibold">{group.name}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
      <Badge variant={required ? 'default' : 'secondary'}>
        {required ? 'Obrigatório' : 'Opcional'}
      </Badge>
    </div>
  );
}

function ModifierGroupPreview({ group, sizeId }: { group: CatalogGroup; sizeId?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <GroupRules group={group} />
      <ul className="divide-y">
        {group.options.map((o) => {
          const price = optionPriceForSize(o, sizeId);
          return (
            <li
              key={o.id}
              className={cn(
                'flex items-center justify-between px-4 py-2 text-sm',
                !o.available && 'opacity-50',
              )}
            >
              <span>
                {o.name}
                {!o.available && (
                  <span className="ml-2 text-xs text-muted-foreground">(esgotado)</span>
                )}
              </span>
              <span className="tabular text-muted-foreground">
                {price > 0 ? `+ ${formatBRL(price)}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Product details as the customer sees them when opening the product. */
export function MenuProductDetails({
  product,
  category,
}: {
  product: CatalogProduct;
  /** Needed for pizzas (sizes with max flavors and crust groups). */
  category?: Pick<CatalogCategory, 'kind' | 'sizes' | 'modifierGroups'>;
}) {
  const isPizza = category?.kind === 'PIZZA';
  const groups = isPizza ? (category?.modifierGroups ?? []) : product.modifierGroups;
  const firstSize = product.sizes.find((s) => s.available)?.id;

  return (
    <div className="space-y-4">
      {product.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt=""
          className="aspect-[4/3] w-full rounded-xl object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageOff className="size-8" />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-xl font-semibold">{product.name}</h3>
        {product.description && (
          <p className="text-sm text-muted-foreground">{product.description}</p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <PriceLabel price={product.price} className="text-lg" />
          <FullPrice product={product} />
        </div>
        {!product.availability.available && (
          <p className="text-sm text-destructive">
            {product.availability.reasons.map((r) => r.message).join(' · ')}
          </p>
        )}
      </div>

      {product.sizes.length > 0 && (
        <div className="overflow-hidden rounded-lg border">
          <div className="bg-muted/60 px-4 py-2">
            <p className="text-sm font-semibold">{isPizza ? 'Tamanho e sabores' : 'Tamanho'}</p>
            <p className="text-xs text-muted-foreground">Escolha 1 opção</p>
          </div>
          <ul className="divide-y">
            {product.sizes.map((s) => (
              <li
                key={s.id}
                className={cn(
                  'flex items-center justify-between px-4 py-2 text-sm',
                  !s.available && 'opacity-50',
                )}
              >
                <span>
                  {s.name}
                  {isPizza && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {s.maxFlavors > 1 ? `até ${s.maxFlavors} sabores` : '1 sabor'}
                      {s.slices ? ` · ${s.slices} fatias` : ''}
                    </span>
                  )}
                </span>
                <span className="tabular">
                  {s.priceCents != null ? formatBRL(s.promoPriceCents ?? s.priceCents) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((g) => (
        <ModifierGroupPreview key={g.groupId} group={g} sizeId={firstSize} />
      ))}
    </div>
  );
}
