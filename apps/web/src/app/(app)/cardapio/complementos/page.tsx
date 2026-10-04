'use client';

import { type ModifierGroupDto, Permission, formatBRL } from '@app/shared';
import { Badge } from '@app/ui/components/badge';
import { Button } from '@app/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@app/ui/components/card';
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
import { Label } from '@app/ui/components/label';
import { Skeleton } from '@app/ui/components/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@app/ui/components/select';
import { toast } from '@app/ui/components/sonner';
import { Textarea } from '@app/ui/components/textarea';
import { ArrowDown, ArrowUp, ListPlus, Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { MoneyInput } from '@/components/form';
import { PauseBadge, PauseButton } from '@/components/menu/menu-fields';
import { EmptyState, Page } from '@/components/page';
import { apiDelete, apiPatch, apiPost, errorMessage, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useCategories, useInvalidateMenu, useModifierGroups, useProducts } from '@/lib/menu';

interface OptionRow {
  id?: string;
  name: string;
  priceCents: number;
  maxQuantity: number;
  productId: string | null;
  sku: string;
  sizePrices: { sizeId: string; priceCents: number }[];
}

const NO_PRODUCT = '__none__';

function GroupDialog({ group, onClose }: { group: ModifierGroupDto | null; onClose: () => void }) {
  const invalidate = useInvalidateMenu();
  const { data: categories = [] } = useCategories();
  const { data: products = [] } = useProducts({});
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [options, setOptions] = useState<OptionRow[]>(
    group?.options.map((o) => ({
      id: o.id,
      name: o.name,
      priceCents: o.priceCents,
      maxQuantity: o.maxQuantity,
      productId: o.productId,
      sku: o.sku ?? '',
      sizePrices: o.sizePrices,
    })) ?? [{ name: '', priceCents: 0, maxQuantity: 1, productId: null, sku: '', sizePrices: [] }],
  );
  const [sizesOpen, setSizesOpen] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Combo options must be single-price products outside pizza categories.
  const comboProducts = products.filter(
    (p) => p.kind === 'STANDARD' && p.categoryKind === 'STANDARD',
  );
  const pizzaSizes = categories
    .filter((c) => c.kind === 'PIZZA')
    .flatMap((c) => c.sizes.map((s) => ({ ...s, label: `${c.name} — ${s.name}` })));

  const update = (index: number, patch: Partial<OptionRow>) =>
    setOptions((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  const move = (index: number, delta: number) =>
    setOptions((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      const body = { name, description, options };
      if (group) await apiPatch(`/menu/modifier-groups/${group.id}`, body);
      else await apiPost('/menu/modifier-groups', body);
      await invalidate();
      toast.success(group ? 'Grupo atualizado' : 'Grupo criado');
      onClose();
    } catch (error) {
      const details = error instanceof ApiError ? Object.values(error.fieldErrors) : [];
      toast.error(details[0] ?? errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {group ? 'Editar grupo de complementos' : 'Novo grupo de complementos'}
          </DialogTitle>
          <DialogDescription>
            O mesmo grupo pode ser usado em várias categorias e produtos. Mínimo e máximo de
            escolhas são definidos em cada vínculo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="group-name">Nome</Label>
            <Input
              id="group-name"
              value={name}
              placeholder="Ex.: Adicionais, Ponto da carne, Borda"
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="group-description">Instrução ao cliente (opcional)</Label>
            <Textarea
              id="group-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Opções</Label>
            {options.map((option, index) => {
              const combo = !!option.productId;
              return (
                <div key={option.id ?? `new-${index}`} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="flex">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(index, -1)}
                        aria-label="Subir"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => move(index, 1)}
                        aria-label="Descer"
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <div className="grid min-w-44 flex-1 gap-1">
                      <span className="text-xs text-muted-foreground">
                        {combo ? 'Produto do cardápio (combo)' : 'Nome da opção'}
                      </span>
                      {combo ? (
                        <Select
                          value={option.productId ?? NO_PRODUCT}
                          onValueChange={(v) =>
                            update(index, { productId: v === NO_PRODUCT ? null : v })
                          }
                        >
                          <SelectTrigger aria-label="Produto do combo">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_PRODUCT}>— Opção comum —</SelectItem>
                            {comboProducts.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input
                          value={option.name}
                          onChange={(e) => update(index, { name: e.target.value })}
                          aria-label="Nome da opção"
                        />
                      )}
                    </div>
                    <div className="grid gap-1">
                      <span className="text-xs text-muted-foreground">Preço adicional</span>
                      <MoneyInput
                        className="w-32"
                        value={option.priceCents}
                        onChange={(v) => update(index, { priceCents: v })}
                        aria-label="Preço adicional"
                      />
                    </div>
                    <div className="grid gap-1">
                      <span className="text-xs text-muted-foreground">Máx. por pedido</span>
                      <Input
                        type="number"
                        min={1}
                        className="w-20"
                        value={option.maxQuantity}
                        onChange={(e) =>
                          update(index, { maxQuantity: Number(e.target.value) || 1 })
                        }
                        aria-label="Quantidade máxima"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover opção"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-16">
                    {!combo && comboProducts.length > 0 && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => update(index, { productId: comboProducts[0]!.id })}
                      >
                        Usar um produto do cardápio (combo)
                      </Button>
                    )}
                    {pizzaSizes.length > 0 && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => setSizesOpen(sizesOpen === index ? null : index)}
                      >
                        <Ruler /> Preço por tamanho
                        {option.sizePrices.length > 0 && ` (${option.sizePrices.length})`}
                      </Button>
                    )}
                  </div>
                  {sizesOpen === index && (
                    <div className="grid gap-2 rounded-md bg-muted/50 p-3 sm:grid-cols-2">
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Ex.: borda recheada mais cara na pizza grande. Vazio = usa o preço adicional
                        acima.
                      </p>
                      {pizzaSizes.map((size) => {
                        const current = option.sizePrices.find((p) => p.sizeId === size.id);
                        return (
                          <label
                            key={size.id}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            {size.label}
                            <MoneyInput
                              className="w-28"
                              value={current?.priceCents ?? 0}
                              onChange={(v) =>
                                update(index, {
                                  sizePrices:
                                    v > 0
                                      ? [
                                          ...option.sizePrices.filter((p) => p.sizeId !== size.id),
                                          { sizeId: size.id, priceCents: v },
                                        ]
                                      : option.sizePrices.filter((p) => p.sizeId !== size.id),
                                })
                              }
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setOptions((prev) => [
                  ...prev,
                  {
                    name: '',
                    priceCents: 0,
                    maxQuantity: 1,
                    productId: null,
                    sku: '',
                    sizePrices: [],
                  },
                ])
              }
            >
              <Plus /> Opção
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} loading={saving}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ModifierGroupsPage() {
  const { can } = useAuth();
  const canManage = can(Permission.MENU_MANAGE);
  const canPause = can(Permission.MENU_PAUSE);
  const invalidate = useInvalidateMenu();
  const { data: groups, isLoading } = useModifierGroups();
  const [editing, setEditing] = useState<ModifierGroupDto | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<ModifierGroupDto | null>(null);

  const remove = async () => {
    if (!deleting) return;
    try {
      await apiDelete(`/menu/modifier-groups/${deleting.id}`);
      await invalidate();
      toast.success('Grupo excluído');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Page
      title="Complementos"
      description="Grupos reutilizáveis de opções: adicionais, ponto da carne, bordas, bebidas de combo"
      actions={
        canManage && (
          <Button onClick={() => setEditing(null)}>
            <Plus /> Grupo
          </Button>
        )
      }
    >
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !groups?.length ? (
        <EmptyState
          icon={ListPlus}
          title="Nenhum grupo de complementos"
          description="Crie grupos como 'Adicionais' ou 'Ponto da carne' e vincule a categorias e produtos."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <Card key={group.id} className="gap-3">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>{group.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Usado em {group.usage.categories} categoria(s) e {group.usage.products}{' '}
                    produto(s)
                  </p>
                </div>
                {canManage && (
                  <div className="flex">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setEditing(group)}
                      aria-label={`Editar ${group.name}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setDeleting(group)}
                      aria-label={`Excluir ${group.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {group.options.map((option) => (
                    <li key={option.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                      <span className="flex-1">
                        {option.displayName}
                        {option.productId && (
                          <Badge variant="outline" className="ml-2">
                            produto
                          </Badge>
                        )}
                        {option.maxQuantity > 1 && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            até {option.maxQuantity}x
                          </span>
                        )}
                      </span>
                      <PauseBadge item={option} />
                      <span className="tabular text-muted-foreground">
                        {option.priceCents > 0 ? `+ ${formatBRL(option.priceCents)}` : 'grátis'}
                        {option.sizePrices.length > 0 && ' · por tamanho'}
                      </span>
                      {canPause && (
                        <PauseButton target={{ kind: 'option', id: option.id }} item={option} />
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing !== undefined && (
        <GroupDialog
          key={editing?.id ?? 'new'}
          group={editing}
          onClose={() => setEditing(undefined)}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir grupo?"
        description={`"${deleting?.name}" será desvinculado de todas as categorias e produtos.`}
        confirmLabel="Excluir"
        destructive
        onConfirm={remove}
      />
    </Page>
  );
}
