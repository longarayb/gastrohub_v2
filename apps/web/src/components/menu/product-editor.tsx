'use client';

import {
  type BusinessHour,
  type CatalogGroup,
  type CatalogProduct,
  type CategoryDto,
  type ModifierLinkInput,
  Permission,
  type ProductDetailDto,
  SALES_CHANNELS,
  type SalesChannel,
  chargedPrice,
  effectiveModifierLinks,
  formatBRL,
} from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@app/ui/components/card';
import { ConfirmDialog } from '@app/ui/components/confirm-dialog';
import { Input } from '@app/ui/components/input';
import { Label } from '@app/ui/components/label';
import { MenuProductCard, MenuProductDetails } from '@app/ui/components/menu-preview';
import { Skeleton, Switch } from '@app/ui/components/misc';
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
import { ArrowLeft, Copy, ImagePlus, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useRef, useState } from 'react';
import { Field, MoneyInput } from '@/components/form';
import { Page } from '@/components/page';
import { ApiError, api, apiDelete, apiPatch, apiPost, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  useCategories,
  useInvalidateMenu,
  useModifierGroups,
  useProduct,
  useSectors,
} from '@/lib/menu';
import { ChannelsField, PauseBadge, PauseButton, ScheduleEditor } from './menu-fields';
import { ModifierLinksEditor } from './modifier-links-editor';

interface SizeRow {
  id?: string;
  name: string;
  priceCents: number;
  promoPriceCents: number | null;
  externalCode: string | null;
}

interface FormState {
  categoryId: string;
  kind: 'STANDARD' | 'SIZED';
  name: string;
  description: string;
  priceCents: number;
  promoPriceCents: number | null;
  sku: string;
  externalCode: string;
  sectorId: string | null;
  channels: SalesChannel[];
  limitSchedule: boolean;
  schedules: BusinessHour[];
  sizes: SizeRow[];
  flavorPrices: Record<string, { priceCents: number; promoPriceCents: number | null }>;
  modifierLinks: ModifierLinkInput[];
}

const NO_SECTOR = '__default__';

function initialState(product: ProductDetailDto | undefined, categoryId: string): FormState {
  return {
    categoryId: product?.categoryId ?? categoryId,
    kind: product?.kind ?? 'STANDARD',
    name: product?.name ?? '',
    description: product?.description ?? '',
    priceCents: product?.priceCents ?? 0,
    promoPriceCents: product?.promoPriceCents ?? null,
    sku: product?.sku ?? '',
    externalCode: product?.externalCode ?? '',
    sectorId: product?.sectorId ?? null,
    channels: product?.channels ?? [...SALES_CHANNELS],
    limitSchedule: (product?.schedules.length ?? 0) > 0,
    schedules: product?.schedules ?? [],
    sizes:
      product?.sizes.map((s) => ({
        id: s.id,
        name: s.name,
        priceCents: s.priceCents,
        promoPriceCents: s.promoPriceCents,
        externalCode: s.externalCode,
      })) ?? [],
    flavorPrices: Object.fromEntries(
      (product?.flavorPrices ?? []).map((f) => [
        f.sizeId,
        { priceCents: f.priceCents, promoPriceCents: f.promoPriceCents },
      ]),
    ),
    modifierLinks: product?.modifierLinks ?? [],
  };
}

/** Promo price input: empty = no promotion. */
function PromoInput({
  value,
  onChange,
  ...props
}: { value: number | null; onChange: (value: number | null) => void } & Omit<
  React.ComponentProps<typeof MoneyInput>,
  'value' | 'onChange'
>) {
  return (
    <div className="flex items-center gap-2">
      <MoneyInput value={value ?? 0} onChange={(v) => onChange(v > 0 ? v : null)} {...props} />
      {value != null && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Sem promoção
        </Button>
      )}
    </div>
  );
}

function ImageCard({ product }: { product: ProductDetailDto }) {
  const input = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidateMenu();
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      await api(`/menu/products/${product.id}/image`, { method: 'POST', body });
      await invalidate();
      toast.success('Foto atualizada');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await apiDelete(`/menu/products/${product.id}/image`);
      await invalidate();
      toast.success('Foto removida');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Foto</CardTitle>
        <CardDescription>
          JPG, PNG, WEBP, AVIF ou HEIC até 8 MB. Convertida para WebP (800 px + miniatura).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        {product.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.thumbUrl} alt="" className="size-24 rounded-lg object-cover" />
        ) : (
          <div className="flex size-24 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <ImagePlus className="size-6" />
          </div>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
          className="hidden"
          aria-label="Arquivo da foto"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <Button
          type="button"
          variant="outline"
          loading={busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlus /> {product.thumbUrl ? 'Trocar foto' : 'Enviar foto'}
        </Button>
        {product.thumbUrl && (
          <Button type="button" variant="ghost" disabled={busy} onClick={remove}>
            <Trash2 /> Remover
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function buildPreview(
  form: FormState,
  category: CategoryDto | undefined,
  groups: ReturnType<typeof useModifierGroups>['data'],
  product: ProductDetailDto | undefined,
): { product: CatalogProduct; category: Parameters<typeof MenuProductDetails>[0]['category'] } {
  const isPizza = category?.kind === 'PIZZA';
  const sizes = isPizza
    ? (category?.sizes ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        maxFlavors: s.maxFlavors,
        slices: s.slices,
        priceCents: form.flavorPrices[s.id]?.priceCents ?? null,
        promoPriceCents: form.flavorPrices[s.id]?.promoPriceCents ?? null,
        available: true,
      }))
    : form.kind === 'SIZED'
      ? form.sizes.map((s, i) => ({
          id: s.id ?? `new-${i}`,
          name: s.name || 'Tamanho',
          maxFlavors: 1,
          slices: null,
          priceCents: s.priceCents,
          promoPriceCents: s.promoPriceCents,
          available: true,
        }))
      : [];
  const tags =
    !isPizza && form.kind === 'STANDARD'
      ? [{ priceCents: form.priceCents, promoPriceCents: form.promoPriceCents }]
      : sizes
          .filter((s) => s.priceCents != null)
          .map((s) => ({ priceCents: s.priceCents!, promoPriceCents: s.promoPriceCents }));
  const charged = tags.map(chargedPrice);

  const toGroup = (link: {
    groupId: string;
    minSelect: number;
    maxSelect: number;
  }): CatalogGroup | null => {
    const group = groups?.find((g) => g.id === link.groupId);
    if (!group) return null;
    return {
      groupId: group.id,
      name: group.name,
      description: group.description,
      minSelect: link.minSelect,
      maxSelect: link.maxSelect,
      options: group.options.map((o) => ({
        id: o.id,
        name: o.displayName,
        priceCents: o.priceCents,
        sizePrices: o.sizePrices,
        maxQuantity: o.maxQuantity,
        available: !o.isPaused,
        product: null,
      })),
    };
  };
  const productLinks = form.modifierLinks.map((l, i) => ({
    groupId: l.groupId,
    minSelect: l.minSelect ?? 0,
    maxSelect: l.maxSelect ?? 1,
    isDisabled: l.isDisabled ?? false,
    sortOrder: i,
  }));
  const links = isPizza ? [] : effectiveModifierLinks(category?.modifierLinks ?? [], productLinks);

  return {
    product: {
      id: product?.id ?? 'preview',
      name: form.name || 'Nome do produto',
      description: form.description || null,
      kind: form.kind,
      sku: form.sku || null,
      sectorId: form.sectorId,
      imageUrl: product?.imageUrl ?? null,
      thumbUrl: product?.thumbUrl ?? null,
      priceCents: !isPizza && form.kind === 'STANDARD' ? form.priceCents : null,
      promoPriceCents: !isPizza && form.kind === 'STANDARD' ? form.promoPriceCents : null,
      price: {
        fromCents: charged.length ? Math.min(...charged) : null,
        toCents: charged.length ? Math.max(...charged) : null,
        hasPromo: tags.some((t) => chargedPrice(t) < t.priceCents),
      },
      sizes,
      modifierGroups: links.map(toGroup).filter((g): g is CatalogGroup => !!g),
      availability: { available: true, reasons: [] },
    },
    category: category && {
      kind: category.kind,
      sizes: category.sizes,
      modifierGroups: isPizza
        ? category.modifierLinks.map(toGroup).filter((g): g is CatalogGroup => !!g)
        : [],
    },
  };
}

function EditorForm({
  product,
  categories,
  initialCategoryId,
}: {
  product?: ProductDetailDto;
  categories: CategoryDto[];
  initialCategoryId: string;
}) {
  const router = useRouter();
  const invalidate = useInvalidateMenu();
  const { can } = useAuth();
  const canEditPrices = can(Permission.PRICES_MANAGE);
  const { data: sectors = [] } = useSectors();
  const { data: groups = [] } = useModifierGroups();
  const [form, setForm] = useState<FormState>(() => initialState(product, initialCategoryId));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ids = {
    name: useId(),
    description: useId(),
    sku: useId(),
    external: useId(),
    price: useId(),
    promo: useId(),
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));
  const category = categories.find((c) => c.id === form.categoryId);
  const isPizza = category?.kind === 'PIZZA';
  const preview = useMemo(
    () => buildPreview(form, category, groups, product),
    [form, category, groups, product],
  );

  const updateSize = (index: number, patch: Partial<SizeRow>) =>
    set(
      'sizes',
      form.sizes.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        categoryId: form.categoryId,
        kind: isPizza ? 'STANDARD' : form.kind,
        name: form.name,
        description: form.description,
        priceCents: !isPizza && form.kind === 'STANDARD' ? form.priceCents : null,
        promoPriceCents: !isPizza && form.kind === 'STANDARD' ? form.promoPriceCents : null,
        sku: form.sku,
        externalCode: form.externalCode,
        sectorId: form.sectorId,
        channels: form.channels,
        schedules: form.limitSchedule ? form.schedules : [],
        sizes: !isPizza && form.kind === 'SIZED' ? form.sizes : [],
        flavorPrices: isPizza
          ? (category?.sizes ?? []).map((s) => ({
              sizeId: s.id,
              priceCents: form.flavorPrices[s.id]?.priceCents ?? 0,
              promoPriceCents: form.flavorPrices[s.id]?.promoPriceCents ?? null,
            }))
          : [],
        modifierLinks: isPizza ? [] : form.modifierLinks,
      };
      const saved = product
        ? await apiPatch<ProductDetailDto>(`/menu/products/${product.id}`, body)
        : await apiPost<ProductDetailDto>('/menu/products', body);
      await invalidate();
      toast.success(product ? 'Produto salvo' : 'Produto criado');
      if (product) setForm(initialState(saved, saved.categoryId));
      if (!product) router.replace(`/cardapio/produtos/${saved.id}` as never);
    } catch (error) {
      const details = error instanceof ApiError ? Object.values(error.fieldErrors) : [];
      toast.error(details[0] ?? errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!product) return;
    try {
      const copy = await apiPost<ProductDetailDto>(`/menu/products/${product.id}/duplicate`);
      await invalidate();
      toast.success('Cópia criada (pausada até você revisar)');
      router.push(`/cardapio/produtos/${copy.id}` as never);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async () => {
    if (!product) return;
    try {
      await apiDelete(`/menu/products/${product.id}`);
      await invalidate();
      toast.success('Produto excluído');
      router.replace('/cardapio');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Page
      title={product ? product.name : 'Novo produto'}
      description={category ? `Categoria: ${category.name}` : undefined}
      className="max-w-7xl"
      actions={
        <>
          <Button variant="ghost" asChild>
            <Link href="/cardapio">
              <ArrowLeft /> Cardápio
            </Link>
          </Button>
          {product && (
            <>
              <PauseButton target={{ kind: 'product', id: product.id }} item={product} />
              <Button variant="outline" onClick={duplicate}>
                <Copy /> Duplicar
              </Button>
              <Button
                variant="ghost"
                onClick={() => setDeleting(true)}
                aria-label="Excluir produto"
              >
                <Trash2 />
              </Button>
            </>
          )}
          <Button onClick={save} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      {product && <PauseBadge item={product} />}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informações</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Nome" htmlFor={ids.name} className="md:col-span-2">
                <Input
                  id={ids.name}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>
              <Field label="Descrição" htmlFor={ids.description} className="md:col-span-2">
                <Textarea
                  id={ids.description}
                  rows={3}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
              <Field label="Categoria">
                <Select value={form.categoryId} onValueChange={(v) => set('categoryId', v)}>
                  <SelectTrigger aria-label="Categoria">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {c.kind === 'PIZZA' ? ' (pizza)' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Setor de produção"
                hint="Para onde o item vai na cozinha (KDS e impressão)"
              >
                <Select
                  value={form.sectorId ?? NO_SECTOR}
                  onValueChange={(v) => set('sectorId', v === NO_SECTOR ? null : v)}
                >
                  <SelectTrigger aria-label="Setor de produção">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SECTOR}>Setor padrão</SelectItem>
                    {sectors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                label="Código interno (PDV)"
                htmlFor={ids.sku}
                hint="Para busca rápida no caixa"
              >
                <Input id={ids.sku} value={form.sku} onChange={(e) => set('sku', e.target.value)} />
              </Field>
              <Field
                label="Código de integração"
                htmlFor={ids.external}
                hint="Opcional (iFood e outros)"
              >
                <Input
                  id={ids.external}
                  value={form.externalCode}
                  onChange={(e) => set('externalCode', e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preço</CardTitle>
              {!canEditPrices && (
                <CardDescription>Seu perfil não pode alterar preços.</CardDescription>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {isPizza ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Preço deste sabor em cada tamanho da categoria. Pizza com vários sabores usa a
                    regra da loja (maior valor ou média).
                  </p>
                  {(category?.sizes ?? []).map((size) => {
                    const price = form.flavorPrices[size.id] ?? {
                      priceCents: 0,
                      promoPriceCents: null,
                    };
                    const flavor = product?.flavorPrices.find((f) => f.sizeId === size.id);
                    const setPrice = (patch: Partial<typeof price>) =>
                      set('flavorPrices', {
                        ...form.flavorPrices,
                        [size.id]: { ...price, ...patch },
                      });
                    return (
                      <div
                        key={size.id}
                        className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
                      >
                        <div className="w-32">
                          <p className="text-sm font-medium">{size.name}</p>
                          <p className="text-xs text-muted-foreground">
                            até {size.maxFlavors} sabores
                          </p>
                        </div>
                        <Field label="Preço">
                          <MoneyInput
                            className="w-36"
                            value={price.priceCents}
                            disabled={!canEditPrices}
                            onChange={(v) => setPrice({ priceCents: v })}
                            aria-label={`Preço ${size.name}`}
                          />
                        </Field>
                        <Field label="Promoção">
                          <PromoInput
                            className="w-36"
                            value={price.promoPriceCents}
                            disabled={!canEditPrices}
                            onChange={(v) => setPrice({ promoPriceCents: v })}
                            aria-label={`Promoção ${size.name}`}
                          />
                        </Field>
                        {product && flavor && (
                          <PauseButton
                            target={{ kind: 'size', productId: product.id, sizeId: size.id }}
                            item={flavor}
                            label="Acabou"
                          />
                        )}
                      </div>
                    );
                  })}
                  {!category?.sizes.length && (
                    <p className="text-sm text-destructive">
                      Esta categoria ainda não tem tamanhos. Cadastre-os em Editar categoria.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="flex gap-2">
                    {(
                      [
                        ['STANDARD', 'Preço único'],
                        ['SIZED', 'Por tamanho'],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={form.kind === value ? 'default' : 'outline'}
                        onClick={() => {
                          set('kind', value);
                          if (value === 'SIZED' && form.sizes.length === 0) {
                            set('sizes', [
                              {
                                name: '',
                                priceCents: 0,
                                promoPriceCents: null,
                                externalCode: null,
                              },
                            ]);
                          }
                        }}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  {form.kind === 'STANDARD' ? (
                    <div className="flex flex-wrap gap-4">
                      <Field label="Preço" htmlFor={ids.price}>
                        <MoneyInput
                          id={ids.price}
                          className="w-40"
                          value={form.priceCents}
                          disabled={!canEditPrices}
                          onChange={(v) => set('priceCents', v)}
                        />
                      </Field>
                      <Field
                        label="Preço promocional"
                        htmlFor={ids.promo}
                        hint="Deixe vazio se não houver"
                      >
                        <PromoInput
                          id={ids.promo}
                          className="w-40"
                          value={form.promoPriceCents}
                          disabled={!canEditPrices}
                          onChange={(v) => set('promoPriceCents', v)}
                        />
                      </Field>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {form.sizes.map((size, index) => {
                        const saved = product?.sizes.find((s) => s.id === size.id);
                        return (
                          <div
                            key={size.id ?? index}
                            className="flex flex-wrap items-end gap-3 rounded-lg border p-3"
                          >
                            <Field label="Tamanho">
                              <Input
                                className="w-40"
                                value={size.name}
                                placeholder="Ex.: Lata 350 ml"
                                onChange={(e) => updateSize(index, { name: e.target.value })}
                              />
                            </Field>
                            <Field label="Preço">
                              <MoneyInput
                                className="w-36"
                                value={size.priceCents}
                                disabled={!canEditPrices}
                                onChange={(v) => updateSize(index, { priceCents: v })}
                                aria-label={`Preço ${size.name}`}
                              />
                            </Field>
                            <Field label="Promoção">
                              <PromoInput
                                className="w-36"
                                value={size.promoPriceCents}
                                disabled={!canEditPrices}
                                onChange={(v) => updateSize(index, { promoPriceCents: v })}
                                aria-label={`Promoção ${size.name}`}
                              />
                            </Field>
                            {product && saved && (
                              <PauseButton
                                target={{ kind: 'size', productId: product.id, sizeId: saved.id }}
                                item={saved}
                              />
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Remover tamanho"
                              onClick={() =>
                                set(
                                  'sizes',
                                  form.sizes.filter((_, i) => i !== index),
                                )
                              }
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          set('sizes', [
                            ...form.sizes,
                            { name: '', priceCents: 0, promoPriceCents: null, externalCode: null },
                          ])
                        }
                      >
                        <Plus /> Tamanho
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Complementos</CardTitle>
              <CardDescription>
                {isPizza
                  ? 'Em pizzas, complementos como borda ficam na categoria e valem uma vez por pizza.'
                  : 'Grupos herdados da categoria podem ser personalizados ou desligados neste produto.'}
              </CardDescription>
            </CardHeader>
            {!isPizza && (
              <CardContent>
                <ModifierLinksEditor
                  value={form.modifierLinks}
                  onChange={(links) => set('modifierLinks', links)}
                  groups={groups}
                  inherited={category?.modifierLinks ?? []}
                />
              </CardContent>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Disponibilidade</CardTitle>
              <CardDescription>Onde e quando este produto pode ser vendido.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Canais de venda</Label>
                <ChannelsField value={form.channels} onChange={(v) => set('channels', v)} />
              </div>
              <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <span>
                  <span className="block text-sm font-medium">Somente em horários específicos</span>
                  <span className="text-xs text-muted-foreground">
                    Desligado = todo o horário da loja (e da categoria).
                  </span>
                </span>
                <Switch
                  checked={form.limitSchedule}
                  onCheckedChange={(v) => set('limitSchedule', v)}
                />
              </label>
              {form.limitSchedule && (
                <ScheduleEditor
                  value={form.schedules}
                  onChange={(v) => set('schedules', v)}
                  emptyLabel="Não vende"
                />
              )}
            </CardContent>
          </Card>

          {product ? (
            <ImageCard product={product} />
          ) : (
            <p className="text-sm text-muted-foreground">Salve o produto para enviar a foto.</p>
          )}
        </div>

        <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Pré-visualização</h2>
            <Badge variant="secondary">como o cliente vê</Badge>
          </div>
          <div className={cn('space-y-4 rounded-card border bg-background p-4')}>
            <MenuProductCard product={preview.product} />
            <MenuProductDetails product={preview.product} category={preview.category} />
          </div>
          {!isPizza && form.kind === 'STANDARD' && form.promoPriceCents != null && (
            <p className="text-xs text-muted-foreground">
              De {formatBRL(form.priceCents)} por {formatBRL(form.promoPriceCents)}.
            </p>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Excluir produto?"
        description="Ele sai do cardápio. Pedidos antigos não são afetados."
        confirmLabel="Excluir"
        destructive
        onConfirm={remove}
      />
    </Page>
  );
}

/** Product create/edit screen with live customer preview. */
export function ProductEditor({
  productId,
  initialCategoryId,
}: {
  productId: string | null;
  initialCategoryId?: string;
}) {
  const { data: categories, isLoading: loadingCategories } = useCategories();
  const { data: product, isLoading: loadingProduct } = useProduct(productId);

  if (loadingCategories || (productId && loadingProduct) || !categories) {
    return (
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (categories.length === 0) {
    return (
      <Page title="Novo produto">
        <p className="text-sm text-muted-foreground">
          Crie uma categoria antes de cadastrar produtos.{' '}
          <Link href="/cardapio" className="text-primary hover:underline">
            Voltar ao cardápio
          </Link>
        </p>
      </Page>
    );
  }
  return (
    <EditorForm
      // Remount per product only: pausing a size must not discard unsaved edits.
      key={product?.id ?? 'new'}
      product={product}
      categories={categories}
      initialCategoryId={initialCategoryId ?? categories[0]!.id}
    />
  );
}
