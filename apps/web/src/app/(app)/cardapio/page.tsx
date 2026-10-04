'use client';

import {
  type CategoryDto,
  Permission,
  type ProductListItemDto,
  SALES_CHANNELS,
  SALES_CHANNEL_LABELS,
  type SalesChannel,
  formatBRL,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card } from '@app/ui/components/card';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@app/ui/components/dropdown-menu';
import { Input } from '@app/ui/components/input';
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { cn } from '@app/ui/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Eye,
  ImageOff,
  MoreVertical,
  Pencil,
  Pizza,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { CategoryDialog } from '@/components/menu/category-dialog';
import { ChannelBadges, PauseBadge, PauseButton } from '@/components/menu/menu-fields';
import { ProductPreviewDialog } from '@/components/menu/product-preview-dialog';
import { DragHandle, SortableList } from '@/components/menu/sortable-list';
import { EmptyState, Page } from '@/components/page';
import { apiDelete, apiPost, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { menuKeys, useCategories, useInvalidateMenu, useProducts, useSectors } from '@/lib/menu';

type Status = 'all' | 'active' | 'paused';
const ALL = '__all__';

function priceText(p: ProductListItemDto) {
  const { fromCents, toCents } = p.price;
  if (fromCents == null) return '—';
  return toCents != null && toCents !== fromCents
    ? `${formatBRL(fromCents)} – ${formatBRL(toCents)}`
    : formatBRL(fromCents);
}

function CategoryRow({
  category,
  selected,
  onSelect,
  onEdit,
  onDelete,
  canManage,
  canPause,
  sortable,
}: {
  category: CategoryDto;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
  canPause: boolean;
  sortable: boolean;
}) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-lg border bg-card p-1 pr-2',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      {sortable && <DragHandle label={`Arrastar ${category.name}`} />}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 p-2 text-left"
      >
        {category.kind === 'PIZZA' ? (
          <Pizza className="size-4 shrink-0 text-primary" />
        ) : (
          <UtensilsCrossed className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{category.name}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {category.productCount} {category.productCount === 1 ? 'produto' : 'produtos'}
            <PauseBadge item={category} />
          </span>
        </span>
      </button>
      {(canManage || canPause) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${category.name}`}>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canManage && (
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Editar
              </DropdownMenuItem>
            )}
            {canManage && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 /> Excluir
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {canPause && (
        <PauseButton
          target={{ kind: 'category', id: category.id }}
          item={category}
          label="Pausar"
        />
      )}
    </div>
  );
}

function ProductRow({
  product,
  showCategory,
  sortable,
  canManage,
  canPause,
  onPreview,
  onDuplicate,
  onDelete,
}: {
  product: ProductListItemDto;
  showCategory: boolean;
  sortable: boolean;
  canManage: boolean;
  canPause: boolean;
  onPreview: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b bg-card px-2 py-2 last:border-b-0">
      {sortable && <DragHandle label={`Arrastar ${product.name}`} />}
      {product.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.thumbUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ImageOff className="size-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/cardapio/produtos/${product.id}` as never}
          className="block truncate font-medium hover:underline"
        >
          {product.name}
        </Link>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {showCategory && <span>{product.categoryName}</span>}
          {product.sku && <Badge variant="outline">#{product.sku}</Badge>}
          {product.sectorName && <Badge variant="secondary">{product.sectorName}</Badge>}
          <ChannelBadges channels={product.channels} />
          <PauseBadge item={product} />
        </div>
      </div>
      <div className="hidden text-right sm:block">
        <p className={cn('tabular text-sm font-medium', product.price.hasPromo && 'text-success')}>
          {priceText(product)}
        </p>
        {product.price.hasPromo && <p className="text-xs text-muted-foreground">em promoção</p>}
      </div>
      {canPause && <PauseButton target={{ kind: 'product', id: product.id }} item={product} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Ações de ${product.name}`}>
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canManage && (
            <DropdownMenuItem asChild>
              <Link href={`/cardapio/produtos/${product.id}` as never}>
                <Pencil /> Editar
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onPreview}>
            <Eye /> Pré-visualizar
          </DropdownMenuItem>
          {canManage && (
            <>
              <DropdownMenuItem onSelect={onDuplicate}>
                <Copy /> Duplicar
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 /> Excluir
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export default function MenuPage() {
  const { can } = useAuth();
  const canManage = can(Permission.MENU_MANAGE);
  const canPause = can(Permission.MENU_PAUSE);
  const router = useRouter();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMenu();

  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const [status, setStatus] = useState<Status>('all');
  const [channel, setChannel] = useState<string>(ALL);
  const [sectorId, setSectorId] = useState<string>(ALL);

  const { data: categories, isLoading: loadingCategories } = useCategories();
  const { data: sectors = [] } = useSectors();
  const filters = {
    q: q || undefined,
    categoryId: categoryId === ALL ? undefined : categoryId,
    status,
    channel: channel === ALL ? undefined : (channel as SalesChannel),
    sectorId: sectorId === ALL ? undefined : sectorId,
  };
  const { data: products, isLoading: loadingProducts } = useProducts(filters);

  const [editingCategory, setEditingCategory] = useState<CategoryDto | null | undefined>(undefined);
  const [deletingCategory, setDeletingCategory] = useState<CategoryDto | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<ProductListItemDto | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const filtering = !!q || status !== 'all' || channel !== ALL || sectorId !== ALL;
  const productsSortable = canManage && !filtering && categoryId !== ALL;

  const reorderCategories = async (ids: string[]) => {
    const previous = categories;
    queryClient.setQueryData<CategoryDto[]>(menuKeys.categories, (old) =>
      ids.map((id) => old!.find((c) => c.id === id)!),
    );
    try {
      await apiPost('/menu/categories/reorder', { ids });
    } catch (error) {
      queryClient.setQueryData(menuKeys.categories, previous);
      toast.error(errorMessage(error));
    }
  };

  const reorderProducts = async (ids: string[]) => {
    const key = menuKeys.products(filters);
    const previous = queryClient.getQueryData<ProductListItemDto[]>(key);
    queryClient.setQueryData<ProductListItemDto[]>(key, (old) =>
      ids.map((id) => old!.find((p) => p.id === id)!),
    );
    try {
      await apiPost('/menu/products/reorder', { categoryId, ids });
      await invalidate();
    } catch (error) {
      queryClient.setQueryData(key, previous);
      toast.error(errorMessage(error));
    }
  };

  const duplicate = async (product: ProductListItemDto) => {
    try {
      const copy = await apiPost<{ id: string }>(`/menu/products/${product.id}/duplicate`);
      await invalidate();
      toast.success('Produto duplicado (pausado até você revisar)');
      router.push(`/cardapio/produtos/${copy.id}` as never);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const removeCategory = async () => {
    if (!deletingCategory) return;
    try {
      await apiDelete(`/menu/categories/${deletingCategory.id}`);
      if (categoryId === deletingCategory.id) setCategoryId(ALL);
      await invalidate();
      toast.success('Categoria excluída');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletingCategory(null);
    }
  };

  const removeProduct = async () => {
    if (!deletingProduct) return;
    try {
      await apiDelete(`/menu/products/${deletingProduct.id}`);
      await invalidate();
      toast.success('Produto excluído');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeletingProduct(null);
    }
  };

  const newProductHref =
    categoryId === ALL
      ? '/cardapio/produtos/novo'
      : `/cardapio/produtos/novo?categoria=${categoryId}`;

  return (
    <Page
      title="Cardápio"
      description="Categorias, produtos, preços e disponibilidade"
      className="max-w-7xl"
      actions={
        canManage && (
          <>
            <Button variant="outline" onClick={() => setEditingCategory(null)}>
              <Plus /> Categoria
            </Button>
            <Button asChild disabled={!categories?.length}>
              <Link href={newProductHref as never}>
                <Plus /> Produto
              </Link>
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-2">
          <button
            type="button"
            onClick={() => setCategoryId(ALL)}
            className={cn(
              'w-full rounded-lg border bg-card px-3 py-2 text-left text-sm font-medium',
              categoryId === ALL && 'border-primary ring-1 ring-primary',
            )}
          >
            Todas as categorias
          </button>
          {loadingCategories ? (
            <Skeleton className="h-40" />
          ) : categories?.length ? (
            <SortableList
              items={categories}
              onReorder={reorderCategories}
              disabled={!canManage}
              className="space-y-2"
              renderItem={(category) => (
                <CategoryRow
                  category={category}
                  selected={categoryId === category.id}
                  onSelect={() => setCategoryId(category.id)}
                  onEdit={() => setEditingCategory(category)}
                  onDelete={() => setDeletingCategory(category)}
                  canManage={canManage}
                  canPause={canPause}
                  sortable={canManage}
                />
              )}
            />
          ) : (
            <p className="px-1 text-sm text-muted-foreground">Nenhuma categoria ainda.</p>
          )}
        </aside>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome, código ou descrição"
                className="pl-9"
                aria-label="Buscar produtos"
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
              <SelectTrigger className="w-36" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Disponíveis</SelectItem>
                <SelectItem value="paused">Pausados</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger className="w-44" aria-label="Canal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os canais</SelectItem>
                {SALES_CHANNELS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {SALES_CHANNEL_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sectors.length > 0 && (
              <Select value={sectorId} onValueChange={setSectorId}>
                <SelectTrigger className="w-40" aria-label="Setor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os setores</SelectItem>
                  {sectors.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {canManage && filtering && categoryId !== ALL && (
            <p className="text-xs text-muted-foreground">
              Limpe a busca e os filtros para reordenar arrastando.
            </p>
          )}

          <Card className="gap-0 overflow-hidden py-0">
            {loadingProducts && !products ? (
              <Skeleton className="h-64" />
            ) : products?.length ? (
              <SortableList
                items={products}
                onReorder={reorderProducts}
                disabled={!productsSortable}
                renderItem={(product) => (
                  <ProductRow
                    product={product}
                    showCategory={categoryId === ALL}
                    sortable={productsSortable}
                    canManage={canManage}
                    canPause={canPause}
                    onPreview={() => setPreviewId(product.id)}
                    onDuplicate={() => duplicate(product)}
                    onDelete={() => setDeletingProduct(product)}
                  />
                )}
              />
            ) : (
              <div className="p-6">
                <EmptyState
                  icon={UtensilsCrossed}
                  title={filtering ? 'Nenhum produto encontrado' : 'Nenhum produto nesta categoria'}
                  description={filtering ? 'Ajuste a busca ou os filtros.' : undefined}
                  action={
                    canManage &&
                    !filtering &&
                    !!categories?.length && (
                      <Button asChild>
                        <Link href={newProductHref as never}>
                          <Plus /> Novo produto
                        </Link>
                      </Button>
                    )
                  }
                />
              </div>
            )}
          </Card>
        </section>
      </div>

      {editingCategory !== undefined && (
        <CategoryDialog
          key={editingCategory?.id ?? 'new'}
          category={editingCategory}
          open
          onOpenChange={(open) => !open && setEditingCategory(undefined)}
        />
      )}
      <ConfirmDialog
        open={!!deletingCategory}
        onOpenChange={(open) => !open && setDeletingCategory(null)}
        title="Excluir categoria?"
        description={`"${deletingCategory?.name}" só pode ser excluída se não tiver produtos.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={removeCategory}
      />
      <ConfirmDialog
        open={!!deletingProduct}
        onOpenChange={(open) => !open && setDeletingProduct(null)}
        title="Excluir produto?"
        description={`"${deletingProduct?.name}" sai do cardápio. Pedidos antigos não são afetados.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={removeProduct}
      />
      <ProductPreviewDialog
        productId={previewId}
        onOpenChange={(open) => !open && setPreviewId(null)}
      />
    </Page>
  );
}
